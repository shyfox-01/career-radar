import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assessJobPresentation, buildSearchPlan, deduplicateJobs } from "./domain/jobs.js";
import { jobsToCsv } from "./domain/csv.js";
import { jobsToXlsx } from "./domain/xlsx.js";
import { auditRowsToCsv, importJobsWithAudit } from "./domain/import-audit.js";
import { normalizeCareerPreferences } from "./domain/profile.js";
import { normalizeApprovedRoles, suggestRoles } from "./domain/roles.js";
import { evaluateTimeline } from "./domain/timeline.js";
import { buildSourceQueue } from "./sources/queue.js";
import { createDiscovery } from "./discovery.js";
import { upsertCompanyWatchlist } from "./companies/watchlist.js";
import { SOURCE_CATALOG } from "./sources/catalog.js";
import { createUnavailableSourceSessionController, getLoginSource } from "./sources/connections.js";
import { createOllamaProvider } from "./providers/ollama.js";
import { launchOllama } from "./providers/local/launch.js";
import { validateProviderContract } from "./providers/provider.js";
import { redactResume } from "./domain/privacy.js";
import { extractResume } from "./resume/extract.js";
import { ALLOWED_JOB_STATUSES, WorkspaceStore } from "./store/workspace-store.js";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(MODULE_DIR);
const PUBLIC_ROOT = path.join(PROJECT_ROOT, "public");
const BODY_LIMIT = 10 * 1024 * 1024;

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function hasSessionCookie(request, accessToken) {
  if (!accessToken) return true;
  const rawCookie = request.headers.cookie ?? "";
  const value = rawCookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === "career_radar_session")?.[1];
  if (!value) return false;
  let supplied;
  try {
    supplied = Buffer.from(decodeURIComponent(value));
  } catch {
    return false;
  }
  const expected = Buffer.from(accessToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new RangeError("Request body is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request) {
  const body = await readBody(request);
  try {
    return body.length ? JSON.parse(body.toString("utf8")) : {};
  } catch {
    throw new TypeError("Request body must be valid JSON");
  }
}

function workspaceIdFrom(pathname) {
  return pathname.split("/")[3];
}

function normalizeImportedJobs(jobs, preferences = {}, searchPlan = []) {
  if (!Array.isArray(jobs)) throw new TypeError("jobs must be an array");
  const now = new Date().toISOString();
  return jobs.map((job) => {
    if (!job || typeof job.title !== "string" || typeof job.company !== "string") {
      throw new TypeError("Each job needs a title and company");
    }
    const status = job.status ?? "new";
    if (!ALLOWED_JOB_STATUSES.includes(status)) {
      throw new TypeError(`Unsupported job status: ${status}`);
    }
    const task = searchPlan.find(
      (entry) => entry.id === job.sourceTaskId || (job.sourceTaskIds ?? []).includes(entry.id),
    );
    const presentation = assessJobPresentation(job, task);
    return {
      ...job,
      id: typeof job.id === "string" ? job.id : randomUUID(),
      status,
      verification: job.verification ?? "ai_unverified",
      importedAt: job.importedAt ?? now,
      firstSeenAt: job.firstSeenAt ?? now,
      lastSeenAt: job.lastSeenAt ?? now,
      timeline: evaluateTimeline(job, preferences),
      ...presentation,
    };
  });
}

function withJobReviews(workspace) {
  const searchPlan = workspace.searchPlan ?? [];
  return {
    ...workspace,
    jobs: (workspace.jobs ?? []).map((job) => {
      const task = searchPlan.find(
        (entry) => entry.id === job.sourceTaskId || (job.sourceTaskIds ?? []).includes(entry.id),
      );
      return { ...job, ...assessJobPresentation(job, task) };
    }),
  };
}

function exportTimestamp() {
  return new Date().toISOString().replaceAll(":", "-").replace(".", "-");
}

function laterTimestamp(left, right) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

async function serveStatic(pathname, response) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  if (!/^[a-zA-Z0-9._/-]+$/u.test(requested) || requested.includes("..")) {
    return false;
  }
  const filename = path.join(PUBLIC_ROOT, requested);
  try {
    const info = await stat(filename);
    if (!info.isFile()) return false;
    const extension = path.extname(filename);
    const type =
      extension === ".html"
        ? "text/html; charset=utf-8"
        : extension === ".css"
          ? "text/css; charset=utf-8"
          : extension === ".js"
            ? "text/javascript; charset=utf-8"
            : "application/octet-stream";
    const body = await readFile(filename);
    response.writeHead(200, {
      "content-type": type,
      "content-length": body.length,
      "x-content-type-options": "nosniff",
    });
    response.end(body);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function createCareerRadarServer({
  dataRoot = process.env.CAREER_RADAR_DATA_DIR ?? path.join(PROJECT_ROOT, ".career-radar-data"),
  accessToken,
  // The only AI the program uses runs on this computer. Without it, source readers and
  // the job ledger work as usual and AI tasks wait in the queue.
  localModelProvider = createOllamaProvider({ startServer: () => launchOllama() }),
  sourceSessionController = createUnavailableSourceSessionController(),
} = {}) {
  const store = new WorkspaceStore({ root: dataRoot });
  const activeDiscovery = new Map();
  const localModel = localModelProvider ? validateProviderContract(localModelProvider) : null;
  const runDiscovery = createDiscovery({
    store,
    sourceSessionController,
    localModel,
    normalizeJobs: normalizeImportedJobs,
  });

  const handleRequest = async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      const { pathname } = url;

      if (!hasSessionCookie(request, accessToken)) {
        return sendJson(response, 401, { error: "Local session authorization required" });
      }

      if (request.method === "GET" && pathname === "/api/health") {
        return sendJson(response, 200, { ok: true, service: "career-radar" });
      }
      if (request.method === "GET" && pathname === "/api/local-model") {
        if (!localModel)
          return sendJson(response, 200, {
            id: null,
            name: "Local model",
            state: "missing",
            installed: false,
            capabilities: { localModel: true, sourceIds: [] },
          });
        let status = await localModel.status();
        // The interface asks for this when it opens: start Ollama if it is installed but not
        // running, then start loading the model.
        if (status.state === "missing" && (await localModel.ensureRunning?.()))
          status = await localModel.status();
        if (status.state === "ready") localModel.prepare?.().catch(() => {});
        return sendJson(response, 200, status);
      }
      if (request.method === "GET" && pathname === "/api/sources") {
        return sendJson(
          response,
          200,
          SOURCE_CATALOG.map(({ searchUrl, ...source }) => ({
            ...source,
            exampleUrl: searchUrl("AI Engineer"),
          })),
        );
      }
      if (request.method === "GET" && pathname === "/api/source-connections") {
        return sendJson(response, 200, await sourceSessionController.list());
      }
      const sourceConnectionMatch = pathname.match(
        /^\/api\/source-connections\/([^/]+)(?:\/(connect|confirm|probe|open))?$/u,
      );
      if (sourceConnectionMatch) {
        const [, sourceId, action] = sourceConnectionMatch;
        const source = getLoginSource(sourceId);
        if (request.method === "POST" && action === "connect") {
          return sendJson(response, 200, await sourceSessionController.connect(source));
        }
        if (request.method === "POST" && action === "confirm") {
          return sendJson(response, 200, await sourceSessionController.confirm(source.id));
        }
        if (request.method === "POST" && action === "probe") {
          return sendJson(response, 200, await sourceSessionController.probe(source.id));
        }
        if (request.method === "POST" && action === "open") {
          const body = await readJson(request);
          return sendJson(
            response,
            200,
            await sourceSessionController.open(source, body.url || source.evidenceUrl),
          );
        }
        if (request.method === "DELETE" && !action) {
          return sendJson(response, 200, await sourceSessionController.disconnect(source.id));
        }
      }

      const workspaceMatch = pathname.match(/^\/api\/workspaces\/([^/]+)$/u);
      if (workspaceMatch && request.method === "GET") {
        return sendJson(
          response,
          200,
          withJobReviews(await store.loadWorkspace(workspaceMatch[1])),
        );
      }
      if (workspaceMatch && request.method === "PUT") {
        const body = await readJson(request);
        return sendJson(response, 200, await store.saveWorkspace(workspaceMatch[1], body));
      }

      if (request.method === "PUT" && /^\/api\/workspaces\/[^/]+\/preferences$/u.test(pathname)) {
        const workspaceId = workspaceIdFrom(pathname);
        const workspace = await store.loadWorkspace(workspaceId);
        workspace.preferences = normalizeCareerPreferences(await readJson(request));
        return sendJson(response, 200, await store.saveWorkspace(workspaceId, workspace));
      }

      if (request.method === "POST" && /^\/api\/workspaces\/[^/]+\/companies$/u.test(pathname)) {
        const workspaceId = workspaceIdFrom(pathname);
        const workspace = await store.loadWorkspace(workspaceId);
        workspace.companyWatchlist = upsertCompanyWatchlist(
          workspace.companyWatchlist ?? [],
          await readJson(request),
        );
        return sendJson(response, 200, await store.saveWorkspace(workspaceId, workspace));
      }

      if (request.method === "GET" && /^\/api\/workspaces\/[^/]+\/companies$/u.test(pathname)) {
        const workspace = await store.loadWorkspace(workspaceIdFrom(pathname));
        return sendJson(response, 200, workspace.companyWatchlist ?? []);
      }

      const companyMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/companies\/([^/]+)$/u);
      if (companyMatch && request.method === "PUT") {
        const workspace = await store.loadWorkspace(companyMatch[1]);
        const previous = (workspace.companyWatchlist ?? []).find(
          (company) => company.id === companyMatch[2],
        );
        if (!previous) throw new RangeError("Company not found");
        const remaining = workspace.companyWatchlist.filter(
          (company) => company.id !== companyMatch[2],
        );
        workspace.companyWatchlist = upsertCompanyWatchlist(remaining, {
          ...previous,
          ...(await readJson(request)),
        });
        return sendJson(response, 200, await store.saveWorkspace(companyMatch[1], workspace));
      }
      if (companyMatch && request.method === "DELETE") {
        const workspace = await store.loadWorkspace(companyMatch[1]);
        const previousLength = (workspace.companyWatchlist ?? []).length;
        workspace.companyWatchlist = (workspace.companyWatchlist ?? []).filter(
          (company) => company.id !== companyMatch[2],
        );
        if (workspace.companyWatchlist.length === previousLength)
          throw new RangeError("Company not found");
        return sendJson(response, 200, await store.saveWorkspace(companyMatch[1], workspace));
      }

      if (
        request.method === "POST" &&
        /^\/api\/workspaces\/[^/]+\/role-suggestions$/u.test(pathname)
      ) {
        const workspaceId = workspaceIdFrom(pathname);
        const body = await readJson(request);
        const workspace = await store.loadWorkspace(workspaceId);
        workspace.roleSuggestions = suggestRoles({
          resumeText: workspace.resume?.redactedPreview ?? "",
          preferences: workspace.preferences ?? {},
          postingSupport: body.postingSupport ?? {},
        });
        return sendJson(response, 200, await store.saveWorkspace(workspaceId, workspace));
      }

      if (
        request.method === "PUT" &&
        /^\/api\/workspaces\/[^/]+\/approved-roles$/u.test(pathname)
      ) {
        const workspaceId = workspaceIdFrom(pathname);
        const body = await readJson(request);
        const workspace = await store.loadWorkspace(workspaceId);
        workspace.approvedRoles = normalizeApprovedRoles(body.titles);
        const approved = new Set(
          workspace.approvedRoles.map((title) => title.toLocaleLowerCase("en")),
        );
        workspace.roleSuggestions = (workspace.roleSuggestions ?? []).map((role) => ({
          ...role,
          selected: approved.has(role.title.toLocaleLowerCase("en")),
        }));
        return sendJson(response, 200, await store.saveWorkspace(workspaceId, workspace));
      }

      if (request.method === "POST" && /^\/api\/workspaces\/[^/]+\/search-plan$/u.test(pathname)) {
        const workspaceId = workspaceIdFrom(pathname);
        const criteria = await readJson(request);
        const workspace = await store.loadWorkspace(workspaceId);
        const approvedCriteria = workspace.approvedRoles?.length
          ? { ...criteria, roleFamilies: undefined, roleTitles: workspace.approvedRoles }
          : criteria;
        workspace.profile = { ...workspace.profile, ...approvedCriteria };
        const roleScores = new Map(
          (workspace.roleSuggestions ?? []).map((role) => [role.title, role.score]),
        );
        const sourceOrder = new Map(
          (approvedCriteria.selectedSourceIds ?? []).map((id, index, values) => [
            id,
            values.length - index,
          ]),
        );
        workspace.searchPlan = buildSearchPlan(approvedCriteria).map((entry) => ({
          ...entry,
          roleScore: roleScores.get(entry.roleTitle) ?? 0,
          sourcePriority: sourceOrder.get(entry.sourceId) ?? 0,
          official: entry.sourceType === "government",
        }));
        workspace.searchQueue = buildSourceQueue(workspace.searchPlan);
        return sendJson(response, 200, await store.saveWorkspace(workspaceId, workspace));
      }

      if (request.method === "POST" && /^\/api\/workspaces\/[^/]+\/resume$/u.test(pathname)) {
        const workspaceId = workspaceIdFrom(pathname);
        const filename = request.headers["x-filename"];
        const extracted = await extractResume({
          filename: Array.isArray(filename) ? filename[0] : filename,
          bytes: await readBody(request),
        });
        const redacted = redactResume(extracted.text);
        const workspace = await store.loadWorkspace(workspaceId);
        workspace.resume = {
          originalFilename: extracted.originalFilename,
          kind: extracted.kind,
          byteLength: extracted.byteLength,
          redactedPreview: redacted.text,
          redactionFindings: redacted.findings,
        };
        await store.saveWorkspace(workspaceId, workspace);
        return sendJson(response, 200, workspace.resume);
      }

      if (request.method === "POST" && /^\/api\/workspaces\/[^/]+\/import\.csv$/u.test(pathname)) {
        const workspaceId = workspaceIdFrom(pathname);
        const rawFilename = request.headers["x-filename"];
        const filename = path.basename(
          String(Array.isArray(rawFilename) ? rawFilename[0] : rawFilename || "previous.csv"),
        );
        const importResult = importJobsWithAudit((await readBody(request)).toString("utf8"));
        const snapshot = importResult.snapshot;
        const workspace = await store.loadWorkspace(workspaceId);
        const importedJobs = normalizeImportedJobs(snapshot.jobs, workspace.preferences);
        const previousCount = workspace.jobs.length;
        workspace.jobs = deduplicateJobs([...workspace.jobs, ...importedJobs]);
        const added = workspace.jobs.length - previousCount;
        const summary = {
          ...importResult.summary,
          added,
          merged: importResult.summary.merged + Math.max(0, importedJobs.length - added),
          total: workspace.jobs.length,
        };
        workspace.latestImportAudit = {
          filename,
          createdAt: new Date().toISOString(),
          rows: importResult.auditRows,
          summary,
        };
        workspace.importHistory = [
          ...(workspace.importHistory ?? []),
          { filename, importedAt: workspace.latestImportAudit.createdAt, ...summary },
        ].slice(-20);
        workspace.lastDiscoveryAt = laterTimestamp(
          workspace.lastDiscoveryAt,
          snapshot.lastDiscoveryAt,
        );
        return sendJson(response, 200, {
          workspace: await store.saveWorkspace(workspaceId, workspace),
          summary,
        });
      }

      if (request.method === "POST" && /^\/api\/workspaces\/[^/]+\/jobs$/u.test(pathname)) {
        const workspaceId = workspaceIdFrom(pathname);
        const body = await readJson(request);
        const workspace = await store.loadWorkspace(workspaceId);
        workspace.jobs = deduplicateJobs([
          ...workspace.jobs,
          ...normalizeImportedJobs(body.jobs, workspace.preferences),
        ]);
        return sendJson(response, 200, await store.saveWorkspace(workspaceId, workspace));
      }

      const statusMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/jobs\/([^/]+)\/status$/u);
      if (request.method === "PATCH" && statusMatch) {
        const body = await readJson(request);
        return sendJson(
          response,
          200,
          await store.updateJobStatus(statusMatch[1], statusMatch[2], body.status),
        );
      }

      if (request.method === "POST" && /^\/api\/workspaces\/[^/]+\/discover$/u.test(pathname)) {
        const workspaceId = workspaceIdFrom(pathname);
        if (activeDiscovery.has(workspaceId))
          throw new TypeError("A search is already running / 搜索正在进行");
        const control = { cancelled: false };
        activeDiscovery.set(workspaceId, control);
        try {
          const workspace = await runDiscovery(workspaceId, {
            automatic: url.searchParams.get("automatic") === "1",
            resumeSource: url.searchParams.get("resumeSource"),
            control,
          });
          return sendJson(response, 200, workspace);
        } finally {
          activeDiscovery.delete(workspaceId);
        }
      }

      if (
        request.method === "POST" &&
        /^\/api\/workspaces\/[^/]+\/cancel-search$/u.test(pathname)
      ) {
        const control = activeDiscovery.get(workspaceIdFrom(pathname));
        if (control) control.cancelled = true;
        return sendJson(response, 200, { cancelled: Boolean(control) });
      }

      if (request.method === "GET" && /^\/api\/workspaces\/[^/]+\/export\.xlsx$/u.test(pathname)) {
        const workspace = withJobReviews(await store.loadWorkspace(workspaceIdFrom(pathname)));
        const bytes = await jobsToXlsx(workspace);
        response.writeHead(200, {
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="career-radar-jobs-${exportTimestamp()}.xlsx"`,
          "x-content-type-options": "nosniff",
        });
        return response.end(bytes);
      }

      if (
        request.method === "GET" &&
        /^\/api\/workspaces\/[^/]+\/import-audit\.csv$/u.test(pathname)
      ) {
        const workspace = await store.loadWorkspace(workspaceIdFrom(pathname));
        if (!workspace.latestImportAudit) throw new RangeError("No import audit is available");
        const csv = auditRowsToCsv(workspace.latestImportAudit.rows);
        response.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="career-radar-import-audit-${exportTimestamp()}.csv"`,
          "x-content-type-options": "nosniff",
        });
        return response.end(`\uFEFF${csv}`);
      }

      if (request.method === "GET" && /^\/api\/workspaces\/[^/]+\/export\.csv$/u.test(pathname)) {
        const workspace = await store.loadWorkspace(workspaceIdFrom(pathname));
        const csv = jobsToCsv(workspace.jobs, {
          lastDiscoveryAt: workspace.lastDiscoveryAt,
        });
        response.writeHead(200, {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="career-radar-jobs-${exportTimestamp()}.csv"`,
          "x-content-type-options": "nosniff",
        });
        return response.end(`\uFEFF${csv}`);
      }

      if (request.method === "GET" && (await serveStatic(pathname, response))) {
        return;
      }
      sendJson(response, 404, { error: "Not found" });
    } catch (error) {
      const status = error instanceof TypeError || error instanceof RangeError ? 400 : 500;
      sendJson(response, status, { error: error.message || "Internal server error" });
    }
  };
  return createServer(async (request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const match = pathname.match(/^\/api\/workspaces\/([^/]+)(?:\/|$)/u);
    const mutation = match && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
    // Discovery writes in page-sized transactions. Status edits have their own
    // transaction; other endpoints are serialized as a whole and cannot change
    // the search configuration while a scan is running.
    const independentlyLocked = /\/(discover|cancel-search|status)$/u.test(pathname);
    if (!mutation || independentlyLocked) return handleRequest(request, response);
    try {
      return await store.runExclusive(match[1], () => {
        if (activeDiscovery.has(match[1]))
          return sendJson(response, 409, {
            error:
              "Pause the search before changing its inputs / 请先暂停搜索再修改输入；投递状态仍可编辑",
          });
        return handleRequest(request, response);
      });
    } catch (error) {
      return sendJson(response, 400, { error: error.message });
    }
  });
}

const isEntrypoint =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.PORT ?? "4317", 10);
  const server = createCareerRadarServer();
  server.listen(port, host, () => {
    process.stdout.write(`Career Radar is running at http://${host}:${port}\n`);
  });
}

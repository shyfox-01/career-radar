import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { createCareerRadarServer } from "../src/server.js";

const dataRoot = path.resolve(".career-radar-data", "tests", "http");
let server;
let origin;
let discoveryInvocation;
const sourceConnectionMetadata = new Map();
const sourceSessionController = {
  async list() {
    return [
      {
        sourceId: "cn-zhipin",
        name: "BOSS直聘",
        market: "CN",
        state: sourceConnectionMetadata.get("cn-zhipin")?.state ?? "not_connected",
        desktopAvailable: true,
        extractionCapability: "assisted_only",
        lastConfirmedAt: sourceConnectionMetadata.get("cn-zhipin")?.lastConfirmedAt ?? null,
        lastOpenedAt: sourceConnectionMetadata.get("cn-zhipin")?.lastOpenedAt ?? null,
      },
    ];
  },
  async connect(source) {
    const next = { state: "connected_unverified" };
    sourceConnectionMetadata.set(source.id, next);
    return { sourceId: source.id, ...next };
  },
  async confirm(sourceId) {
    const next = { state: "connected", lastConfirmedAt: "2026-09-07T08:00:00.000Z" };
    sourceConnectionMetadata.set(sourceId, next);
    return { sourceId, ...next };
  },
  async probe(sourceId) {
    return {
      sourceId,
      state: "connected",
      adapterId: "linkedin",
      authentication: "signed_in",
      extraction: "ready",
    };
  },
  async discover(tasks) {
    return {
      jobs: [],
      completedTaskIds: [],
      failedTasks: [],
      unsupportedTaskIds: tasks.map((task) => task.id),
    };
  },
  async open(source, url) {
    const next = {
      ...(sourceConnectionMetadata.get(source.id) ?? {}),
      lastOpenedAt: "2026-09-07T08:01:00.000Z",
    };
    sourceConnectionMetadata.set(source.id, next);
    return { sourceId: source.id, url, ...next };
  },
  async disconnect(sourceId) {
    sourceConnectionMetadata.delete(sourceId);
    return { sourceId, state: "not_connected" };
  },
};

test.before(async () => {
  await rm(dataRoot, { recursive: true, force: true });
  await mkdir(dataRoot, { recursive: true });
  server = createCareerRadarServer({
    dataRoot,
    // A stand-in for the local model, so this server never reaches a real Ollama.
    localModelProvider: {
      id: "ollama",
      name: "Fake local model",
      async detect() {
        return { installed: true };
      },
      async status() {
        return {
          id: "ollama",
          name: "Fake local model",
          state: "ready",
          model: "fake:1b",
          capabilities: { localModel: true, sourceIds: [] },
        };
      },
      capabilities() {
        return { discovery: true };
      },
      async discover(input, options) {
        discoveryInvocation = { input, options };
        return { jobs: [] };
      },
    },
    sourceSessionController,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dataRoot, {
    recursive: true,
    force: true,
  });
});

test("health and local model endpoints expose local readiness", async () => {
  const health = await fetch(`${origin}/api/health`).then((response) => response.json());
  const model = await fetch(`${origin}/api/local-model`).then((response) => response.json());

  assert.deepEqual(health, { ok: true, service: "career-radar" });
  assert.equal(model.state, "ready");
  assert.equal(model.model, "fake:1b");
  for (const removed of ["/api/account", "/api/api-configs", "/api/providers"]) {
    assert.equal((await fetch(`${origin}${removed}`)).status, 404, removed);
  }
});

test("source connection API supports connect, confirm, open, and disconnect", async () => {
  const initial = await fetch(`${origin}/api/source-connections`).then((response) =>
    response.json(),
  );
  assert.equal(initial[0].state, "not_connected");

  const connected = await fetch(`${origin}/api/source-connections/cn-zhipin/connect`, {
    method: "POST",
  }).then((response) => response.json());
  assert.equal(connected.state, "connected_unverified");

  const confirmed = await fetch(`${origin}/api/source-connections/cn-zhipin/confirm`, {
    method: "POST",
  }).then((response) => response.json());
  assert.equal(confirmed.state, "connected");

  const opened = await fetch(`${origin}/api/source-connections/cn-zhipin/open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://www.zhipin.com/web/geek/jobs?query=AI%20Engineer" }),
  }).then((response) => response.json());
  assert.equal(opened.url.startsWith("https://www.zhipin.com/"), true);

  const removed = await fetch(`${origin}/api/source-connections/cn-zhipin`, {
    method: "DELETE",
  }).then((response) => response.json());
  assert.equal(removed.state, "not_connected");
});

test("source connection API probes real authentication and extraction capability", async () => {
  const response = await fetch(`${origin}/api/source-connections/sg-linkedin/probe`, {
    method: "POST",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    sourceId: "sg-linkedin",
    state: "connected",
    adapterId: "linkedin",
    authentication: "signed_in",
    extraction: "ready",
  });
});

test("source connection API rejects direct and unknown sources", async () => {
  const direct = await fetch(`${origin}/api/source-connections/sg-mcf/connect`, { method: "POST" });
  const unknown = await fetch(`${origin}/api/source-connections/not-real/connect`, {
    method: "POST",
  });
  assert.equal(direct.status, 400);
  assert.equal(unknown.status, 400);
});

test("workspace API creates a plan, imports a job, and updates its status", async () => {
  const planResponse = await fetch(`${origin}/api/workspaces/demo/search-plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      markets: ["SG", "HK"],
      roleFamilies: ["product"],
      employmentTypes: ["internship"],
    }),
  });
  assert.equal(planResponse.status, 200);
  const plan = await planResponse.json();
  assert.ok(plan.searchPlan.length >= 2);

  const importResponse = await fetch(`${origin}/api/workspaces/demo/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobs: [
        {
          title: "AI Product Intern",
          company: "Fictional Harbour",
          location: "Hong Kong",
          url: "https://example.test/jobs/8?utm_source=manual",
          source: "Manual import",
        },
      ],
    }),
  });
  assert.equal(importResponse.status, 200);
  const imported = await importResponse.json();
  assert.equal(imported.jobs.length, 1);
  const jobId = imported.jobs[0].id;

  const statusResponse = await fetch(`${origin}/api/workspaces/demo/jobs/${jobId}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "applied" }),
  });
  assert.equal(statusResponse.status, 200);
  const updated = await statusResponse.json();
  assert.equal(updated.jobs[0].status, "applied");
});

test("resume endpoint returns a redacted preview without echoing contacts", async () => {
  const response = await fetch(`${origin}/api/workspaces/demo/resume`, {
    method: "POST",
    headers: {
      "content-type": "text/plain",
      "x-filename": "resume.txt",
    },
    body: "Fictional Candidate\nfictional@example.com\nPython SQL",
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(body).includes("fictional@example.com"), false);
  assert.match(body.redactedPreview, /REDACTED EMAIL/);
});

test("career preferences endpoint persists a separate allowlisted profile", async () => {
  const response = await fetch(`${origin}/api/workspaces/preferences/preferences`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      major: " Data Science ",
      graduationDate: "2026-12-15",
      internshipAvailableFrom: "2026-05-01",
      markets: ["SG"],
      roleInterests: ["ML Engineer"],
      internshipWindows: [{ start: "2026-05-01", end: "2026-08-31" }],
      unrelatedSecret: "discard me",
    }),
  });
  const workspace = await response.json();

  assert.equal(response.status, 200);
  assert.equal("major" in workspace.preferences, false);
  assert.equal(workspace.preferences.graduationDate, "2026-12-15");
  assert.equal(workspace.preferences.internshipAvailableFrom, "2026-05-01");
  assert.equal("unrelatedSecret" in workspace.preferences, false);
  assert.equal(workspace.resume, undefined);
});

test("role suggestions use the saved profile and require explicit approval", async () => {
  await fetch(`${origin}/api/workspaces/roles/resume`, {
    method: "POST",
    headers: { "x-filename": "resume.txt" },
    body: "Built Python LLM and RAG applications with machine learning pipelines.",
  });
  await fetch(`${origin}/api/workspaces/roles/preferences`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      markets: ["SG"],
      roleInterests: ["AI Engineer"],
      emphasizedSkills: ["Python", "LLM"],
    }),
  });

  const suggestionResponse = await fetch(`${origin}/api/workspaces/roles/role-suggestions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ postingSupport: { ai_engineer: 10 } }),
  });
  const suggested = await suggestionResponse.json();
  assert.equal(suggestionResponse.status, 200);
  assert.equal(suggested.roleSuggestions[0].id, "ai_engineer");
  assert.equal(suggested.roleSuggestions[0].selected, false);
  assert.ok(suggested.roleSuggestions[0].evidence.length > 0);

  const approvalResponse = await fetch(`${origin}/api/workspaces/roles/approved-roles`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ titles: ["AI Engineer", "Data Scientist", "AI Engineer"] }),
  });
  const approved = await approvalResponse.json();
  assert.equal(approvalResponse.status, 200);
  assert.deepEqual(approved.approvedRoles, ["AI Engineer", "Data Scientist"]);
});

test("job normalization attaches advisory dates and duration without excluding", async () => {
  await fetch(`${origin}/api/workspaces/timeline/preferences`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      internshipAvailableFrom: "2027-02-01",
    }),
  });
  const response = await fetch(`${origin}/api/workspaces/timeline/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobs: [
        {
          title: "Winter Intern",
          company: "Fictional Co",
          employmentType: "internship",
          startDate: "2027-01-01",
          endDate: "2027-03-01",
          durationRequirement: "At least 6 months",
          daysPerWeek: 2,
        },
        {
          title: "Flexible Intern",
          company: "Example Co",
          employmentType: "internship",
        },
      ],
    }),
  });
  const workspace = await response.json();

  assert.equal(response.status, 200);
  const winter = workspace.jobs.find((job) => job.title === "Winter Intern");
  assert.equal(winter.timeline.status, "advisory");
  assert.equal(winter.timeline.durationLabel, "At least 6 months");
  assert.equal(
    workspace.jobs.find((job) => job.title === "Flexible Intern").timeline.status,
    "date_unknown",
  );
});

test("CSV export uses stable columns and neutralizes spreadsheet formulas", async () => {
  await fetch(`${origin}/api/workspaces/csv/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobs: [
        {
          title: '=HYPERLINK("bad")',
          company: "Fictional Co",
          location: "Singapore",
          source: "Manual",
        },
      ],
    }),
  });

  const response = await fetch(`${origin}/api/workspaces/csv/export.csv`);
  const csv = await response.text();
  assert.match(csv, /^id,title,company,location,employmentType,status,score,source,url/m);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.match(
    response.headers.get("content-disposition"),
    /^attachment; filename="career-radar-jobs-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.csv"$/,
  );
});

test("CSV baseline import preserves status and merges without changing the source file", async () => {
  const baseline = [
    "id,title,company,location,employmentType,status,score,source,url,statusUpdatedAt,firstSeenAt,lastSeenAt,postedAt,verification,snapshotLastDiscoveryAt",
    "history-1,AI Intern,Fictional Harbour,Singapore,internship,applied,80,Previous CSV,https://example.test/jobs/history-1,2026-09-05T10:00:00.000Z,2026-09-01T08:00:00.000Z,2026-09-05T08:00:00.000Z,2026-08-30,source_checked,2026-09-05T12:00:00.000Z",
  ].join("\r\n");

  const response = await fetch(`${origin}/api/workspaces/incremental/import.csv`, {
    method: "POST",
    headers: { "content-type": "text/csv", "x-filename": "previous.csv" },
    body: baseline,
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result.summary, {
    accepted: 1,
    normalized: 0,
    merged: 0,
    quarantined: 0,
    ignoredColumns: 0,
    totalRows: 1,
    added: 1,
    total: 1,
  });
  assert.equal(result.workspace.jobs[0].status, "applied");
  assert.equal(result.workspace.lastDiscoveryAt, "2026-09-05T12:00:00.000Z");
  assert.equal(result.workspace.importHistory[0].filename, "previous.csv");

  const mergeResponse = await fetch(`${origin}/api/workspaces/incremental/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jobs: [
        {
          title: "AI Intern",
          company: "Fictional Harbour",
          location: "Singapore",
          url: "https://example.test/jobs/history-1?utm_source=new",
          description: "A much richer description from the latest scan.",
          status: "new",
          source: "Fresh scan",
        },
      ],
    }),
  });
  const merged = await mergeResponse.json();
  assert.equal(merged.jobs.length, 1);
  assert.equal(merged.jobs[0].id, "history-1");
  assert.equal(merged.jobs[0].status, "applied");
  assert.match(merged.jobs[0].description, /richer description/);
});

test("CSV import keeps valid rows, quarantines invalid rows, and exports an audit", async () => {
  const csv = [
    "title,company,status,legacyNote",
    " AI Intern ,Fictional Co,已投递,=legacy",
    ",Missing Title,new,bad",
  ].join("\r\n");
  const response = await fetch(`${origin}/api/workspaces/audited/import.csv`, {
    method: "POST",
    headers: { "content-type": "text/csv", "x-filename": "mixed.csv" },
    body: csv,
  });
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.workspace.jobs.length, 1);
  assert.equal(result.workspace.jobs[0].title, "AI Intern");
  assert.equal(result.summary.normalized, 1);
  assert.equal(result.summary.quarantined, 1);
  assert.equal(result.summary.ignoredColumns, 1);

  const auditResponse = await fetch(`${origin}/api/workspaces/audited/import-audit.csv`);
  const audit = await auditResponse.text();
  assert.equal(auditResponse.status, 200);
  assert.match(audit, /ignored_column/u);
  assert.match(audit, /quarantined/u);
  assert.match(audit, /"'=legacy"/u);
});

test("discovery gives the local model only the redacted preview", async () => {
  await fetch(`${origin}/api/workspaces/discovery/resume`, {
    method: "POST",
    headers: { "x-filename": "resume.txt" },
    body: "Fictional Candidate fictional@example.com Python",
  });
  await fetch(`${origin}/api/workspaces/discovery/search-plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      markets: ["SG"],
      roleFamilies: ["ai_engineering"],
      employmentTypes: ["internship"],
    }),
  });

  const response = await fetch(`${origin}/api/workspaces/discovery/discover`, {
    method: "POST",
  });

  assert.equal(response.status, 200);
  assert.equal(discoveryInvocation.input.redactedResume.includes("fictional@example.com"), false);
  assert.equal(typeof discoveryInvocation.options.shouldStop, "function");
  const firstDiscoveryAt = (await response.json()).lastDiscoveryAt;
  assert.match(firstDiscoveryAt, /^\d{4}-\d{2}-\d{2}T/);

  await fetch(`${origin}/api/workspaces/discovery/discover`, { method: "POST" });
  assert.deepEqual(discoveryInvocation.input.incremental, {
    scanSince: firstDiscoveryAt,
    overlapHours: 48,
    knownJobCount: 0,
  });
});

test("discovery executes ready LinkedIn adapter tasks without requiring an AI provider call", async () => {
  const adapterRoot = path.resolve(".career-radar-data", "tests", "http-linkedin-adapter");
  await rm(adapterRoot, { recursive: true, force: true });
  await mkdir(adapterRoot, { recursive: true });
  let adapterInvocation;
  let providerCalls = 0;
  const adapterServer = createCareerRadarServer({
    dataRoot: adapterRoot,
    localModelProvider: {
      id: "test-provider",
      name: "Test Provider",
      async detect() {
        return { installed: true, authenticated: true };
      },
      async status() {
        return { id: "test-provider", state: "ready" };
      },
      async capabilities() {
        return { discovery: true };
      },
      async discover() {
        providerCalls += 1;
        return { jobs: [] };
      },
    },
    sourceSessionController: {
      ...sourceSessionController,
      async discover(tasks) {
        adapterInvocation = structuredClone(tasks);
        return {
          jobs: [
            {
              title: "Data Engineer Intern",
              company: "Example Labs",
              location: "Singapore",
              url: "https://www.linkedin.com/jobs/view/1234567890",
              source: "LinkedIn Jobs",
              sourceId: "sg-linkedin",
              sourceTaskId: tasks[0].id,
              verification: "source_checked",
            },
          ],
          completedTaskIds: [tasks[0].id],
          failedTasks: [],
          unsupportedTaskIds: [],
        };
      },
    },
  });
  await new Promise((resolve) => adapterServer.listen(0, "127.0.0.1", resolve));
  const adapterOrigin = `http://127.0.0.1:${adapterServer.address().port}`;
  try {
    await fetch(`${adapterOrigin}/api/workspaces/linkedin-adapter/resume`, {
      method: "POST",
      headers: { "x-filename": "resume.txt" },
      body: "Fictional candidate with Python and SQL",
    });
    await fetch(`${adapterOrigin}/api/workspaces/linkedin-adapter/search-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        markets: ["SG"],
        roleTitles: ["Data Engineer"],
        employmentTypes: ["internship"],
        selectedSourceIds: ["sg-linkedin"],
      }),
    });

    const response = await fetch(`${adapterOrigin}/api/workspaces/linkedin-adapter/discover`, {
      method: "POST",
    });
    const workspace = await response.json();
    assert.equal(response.status, 200);
    assert.equal(adapterInvocation.length, 1);
    assert.equal(adapterInvocation[0].sourceId, "sg-linkedin");
    assert.equal(providerCalls, 0);
    assert.equal(workspace.jobs.length, 1);
    assert.equal(workspace.jobs[0].verification, "source_checked");
    assert.equal(workspace.jobs[0].reviewStatus, "recommended");
    assert.deepEqual(workspace.jobs[0].reviewReasons, []);
    assert.deepEqual(workspace.lastSourceAdapterRun, {
      completedTaskIds: [adapterInvocation[0].id],
      failedTasks: [],
      unsupportedTaskIds: [],
      pendingTasks: [],
      scans: [],
    });
  } finally {
    await new Promise((resolve) => adapterServer.close(resolve));
    await rm(adapterRoot, { recursive: true, force: true });
  }
});

test("search plan executes forty tasks and preserves overflow for the next run", async () => {
  await fetch(`${origin}/api/workspaces/queue/resume`, {
    method: "POST",
    headers: { "x-filename": "resume.txt" },
    body: "Fictional Python data and product profile",
  });
  await fetch(`${origin}/api/workspaces/queue/approved-roles`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      titles: ["AI Engineer", "Data Scientist", "Product Manager", "Risk Analyst"],
    }),
  });
  const plannedResponse = await fetch(`${origin}/api/workspaces/queue/search-plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      markets: ["SG"],
      employmentTypes: ["internship", "full_time"],
      selectedSourceIds: [
        "sg-mcf",
        "sg-linkedin",
        "sg-jobstreet",
        "sg-indeed",
        "sg-internsg",
        "sg-glints",
        "sg-grad",
        "sg-efc",
        "sg-careersgov",
        "sg-jobscentral",
      ],
    }),
  });
  const planned = await plannedResponse.json();
  assert.equal(planned.searchPlan.length, 80);
  assert.equal(planned.searchQueue.executeIds.length, 40);
  assert.equal(planned.searchQueue.queuedIds.length, 40);

  const discoveryResponse = await fetch(`${origin}/api/workspaces/queue/discover`, {
    method: "POST",
  });
  const discovered = await discoveryResponse.json();
  assert.equal(discoveryResponse.status, 200);
  assert.equal(discoveryInvocation.input.plan.length, 40);
  assert.deepEqual(discovered.lastExecutedTaskIds, planned.searchQueue.executeIds);
  assert.equal(discovered.searchQueue.executeIds.length, 40);
  assert.equal(discovered.searchQueue.queuedIds.length, 0);
});

test("company watchlist endpoints add, update, list, and delete safe public careers pages", async () => {
  const createdResponse = await fetch(`${origin}/api/workspaces/companies/companies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Fictional Bank",
      markets: ["SG"],
    }),
  });
  const created = await createdResponse.json();
  assert.equal(createdResponse.status, 200);
  assert.equal(created.companyWatchlist.length, 1);
  const companyId = created.companyWatchlist[0].id;
  assert.equal(created.companyWatchlist[0].officialDomainState, "unverified");
  assert.equal(created.companyWatchlist[0].careersUrl, null);

  const updatedResponse = await fetch(`${origin}/api/workspaces/companies/companies/${companyId}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      careersUrl: "https://fictional-bank.example/careers",
      markets: ["SG", "HK"],
    }),
  });
  const updated = await updatedResponse.json();
  assert.equal(updated.companyWatchlist[0].careersUrl, "https://fictional-bank.example/careers");
  assert.deepEqual(updated.companyWatchlist[0].markets, ["SG", "HK"]);

  const listed = await fetch(`${origin}/api/workspaces/companies/companies`).then((response) =>
    response.json(),
  );
  assert.equal(listed.length, 1);

  const deletedResponse = await fetch(`${origin}/api/workspaces/companies/companies/${companyId}`, {
    method: "DELETE",
  });
  const deleted = await deletedResponse.json();
  assert.equal(deleted.companyWatchlist.length, 0);
});

test("a packaged server rejects API requests without its launch-session cookie", async (context) => {
  const protectedRoot = path.resolve(".career-radar-data", "tests", "protected-http");
  const protectedServer = createCareerRadarServer({
    dataRoot: protectedRoot,
    accessToken: "fictional-launch-token",
  });
  await new Promise((resolve) => protectedServer.listen(0, "127.0.0.1", resolve));
  context.after(async () => {
    await new Promise((resolve) => protectedServer.close(resolve));
    await rm(protectedRoot, { recursive: true, force: true });
  });
  const protectedOrigin = `http://127.0.0.1:${protectedServer.address().port}`;

  const missing = await fetch(`${protectedOrigin}/api/health`);
  const incorrect = await fetch(`${protectedOrigin}/api/health`, {
    headers: { cookie: "career_radar_session=wrong-token" },
  });
  const malformed = await fetch(`${protectedOrigin}/api/health`, {
    headers: { cookie: "career_radar_session=%" },
  });
  const allowed = await fetch(`${protectedOrigin}/api/health`, {
    headers: {
      cookie: "career_radar_session=fictional-launch-token",
    },
  });

  assert.equal(missing.status, 401);
  assert.equal(incorrect.status, 401);
  assert.equal(malformed.status, 401);
  assert.equal(allowed.status, 200);
});

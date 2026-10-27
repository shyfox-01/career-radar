// Read-only diagnostic: run each portal/LinkedIn adapter against its live site.
// Prints capability + card counts only. Never logs credentials or page HTML.
import { app, BrowserWindow, session } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSourceAdapterRegistry } from "../src/sources/adapters/registry.js";
import { getSourceById } from "../src/sources/catalog.js";

const root = process.env.PROBE_ROOT;
if (!root || !path.isAbsolute(root)) throw Error("Set absolute PROBE_ROOT");
app.setPath("userData", path.join(root, "browser"));
app.commandLine.appendSwitch("lang", "en-US");

const ids = (process.env.PROBE_SOURCES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const maxPages = Number(process.env.PROBE_PAGES ?? 1);
const perSourceMs = Number(process.env.PROBE_TIMEOUT_MS ?? 120000);
const show = process.env.PROBE_SHOW === "1";

function driverFor(window) {
  return {
    async navigate(target) {
      // Same rule as the desktop app: a parsed page gets a grace period instead of waiting
      // for a load event a hanging tracker may never let fire. Timers are cleared once the
      // page settles; a stray one would touch a window closed by then.
      let timer, grace;
      const onDomReady = () => {
        grace = setTimeout(() => {
          if (!window.isDestroyed()) window.webContents.stop();
          window.emit("probe-dom-grace");
        }, 10000);
      };
      window.webContents.once("dom-ready", onDomReady);
      const loading = window.loadURL(target);
      loading.catch(() => {});
      await Promise.race([
        loading,
        new Promise((resolve) => window.once("probe-dom-grace", resolve)),
        new Promise((_, rej) => {
          timer = setTimeout(() => {
            if (!window.isDestroyed()) window.webContents.stop();
            rej(Object.assign(Error("timeout"), { code: "page_load_timeout" }));
          }, 40000);
        }),
      ])
        .catch((e) => {
          if (e?.code !== "ERR_ABORTED") throw e;
        })
        .finally(() => {
          clearTimeout(timer);
          clearTimeout(grace);
          if (!window.isDestroyed()) window.webContents.removeListener("dom-ready", onDomReady);
        });
    },
    async waitForReady() {},
    async snapshot(script) {
      return window.webContents.executeJavaScript(script, true);
    },
    async act(script) {
      return window.webContents.executeJavaScript(script, true);
    },
  };
}

async function probeOne(sourceId, registry) {
  const source = getSourceById(sourceId);
  const adapter = registry.get(sourceId);
  const out = { sourceId, name: source?.name, adapterId: adapter?.id ?? null };
  if (!adapter) {
    out.error = "no_adapter";
    return out;
  }
  const window = new BrowserWindow({
    width: 1400,
    height: 1000,
    show,
    webPreferences: {
      partition: `persist:career-radar-source-${sourceId}`,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  const driver = driverFor(window);
  // The timer is cleared when this source finishes. Left running, it rejects during a later
  // source with nothing listening, and Electron's error dialog then halts the whole probe.
  let timer;
  const deadline = new Promise((_, rej) => {
    timer = setTimeout(
      () => rej(Object.assign(Error("probe timeout"), { code: "probe_timeout" })),
      perSourceMs,
    );
  });
  deadline.catch(() => {});
  try {
    out.probe = await Promise.race([adapter.probe({ driver, source }), deadline]);
  } catch (e) {
    out.probeError = { code: e.code ?? e.name, message: String(e.message).slice(0, 200) };
  }
  if (out.probe?.extraction === "ready") {
    const query = source.market === "CN" ? "数据分析" : "Data Analyst";
    const task = {
      id: `probe:${sourceId}`,
      sourceId,
      market: source.market,
      employmentType: "full_time",
      roleTitle: query,
      query,
      searchUrl: source.searchUrl(query),
    };
    try {
      const result = await Promise.race([
        adapter.discover({ driver, source, task, maxPages }),
        deadline,
      ]);
      out.scan = result.scan;
      out.jobCount = result.jobs.length;
      out.sample = result.jobs
        .slice(0, 3)
        .map((j) => ({ title: j.title, company: j.company, location: j.location, url: j.url }));
      out.missingCompany = result.jobs.filter((j) => !j.company).length;
      out.warnings = result.jobs.flatMap((j) => j.sourceFieldWarnings ?? []).length;
    } catch (e) {
      out.discoverError = { code: e.code ?? e.name, message: String(e.message).slice(0, 200) };
    }
  }
  clearTimeout(timer);
  try {
    out.finalUrl = window.webContents.getURL().slice(0, 160);
  } catch {}
  if (!window.isDestroyed()) window.destroy();
  return out;
}

app
  .whenReady()
  .then(async () => {
    await mkdir(root, { recursive: true });
    const registry = createSourceAdapterRegistry();
    const results = [];
    for (const id of ids) {
      process.stdout.write(`\n### ${id}\n`);
      let r;
      try {
        r = await probeOne(id, registry);
      } catch (e) {
        r = { sourceId: id, fatal: String(e.message).slice(0, 200) };
      }
      results.push(r);
      process.stdout.write(JSON.stringify(r, null, 1) + "\n");
      await writeFile(path.join(root, "probe-results.json"), JSON.stringify(results, null, 2));
    }
    app.quit();
  })
  .catch((e) => {
    console.error("FATAL", e);
    app.quit();
  });
app.on("window-all-closed", () => {});

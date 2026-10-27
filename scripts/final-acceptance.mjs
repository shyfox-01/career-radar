import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as pause } from "node:timers/promises";
import { app, BrowserWindow, session, shell } from "electron";
import { createCareerRadarServer } from "../src/server.js";
import { createElectronSourceSessionController } from "../src/desktop/source-sessions.js";
import { createJsonFileRepository } from "../src/store/json-file.js";
import { buildSearchPlan } from "../src/domain/jobs.js";

const root = process.env.CAREER_RADAR_FINAL_ACCEPTANCE_ROOT;
if (!root || !path.isAbsolute(root))
  throw new Error("CAREER_RADAR_FINAL_ACCEPTANCE_ROOT must be an isolated absolute path");

const output = {
  ok: false,
  syntheticProfile:
    "Python, SQL, data preprocessing and dashboard projects. Seeking a Data Analyst internship in Singapore.",
  usedAI: false,
  lightweight: null,
  fullSource: null,
};
let controller;
let server;
let mainWindow;

app.setPath("userData", path.join(root, "browser"));
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  controller?.shutdown();
  server?.close();
});

async function waitFor(
  run,
  predicate,
  { timeoutMs = 180000, intervalMs = 300, label = "condition" } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let value;
  while (Date.now() < deadline) {
    value = await run();
    if (predicate(value)) return value;
    await pause(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(value)}`);
}

async function click(selector) {
  return mainWindow.webContents.executeJavaScript(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing ${selector}');e.click();return true;})()`,
  );
}

async function setValue(selector, value) {
  return mainWindow.webContents.executeJavaScript(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing ${selector}');const p=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value');p.set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;})()`,
  );
}

async function capturePanel(selector, filename) {
  await mainWindow.webContents.executeJavaScript(
    `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'start',behavior:'instant'});true`,
  );
  await pause(300);
  const image = await mainWindow.webContents.capturePage();
  const target = path.join(root, filename);
  await writeFile(target, image.toPNG());
  return target;
}

async function runUiAcceptance(origin) {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1360,
    height: 900,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  await mainWindow.loadURL(origin);
  const run = (script) => mainWindow.webContents.executeJavaScript(script, true);
  await waitFor(
    () => run(`Boolean(document.querySelector('input[name="sources"][value="sg-jobstreet"]'))`),
    Boolean,
    { label: "source catalog" },
  );

  await setValue("#resume-text", output.syntheticProfile);
  await click("#paste-resume");
  await waitFor(
    () => run(`document.querySelector('#resume-state').textContent`),
    (value) => value.includes("pasted-resume.txt"),
    { label: "resume import" },
  );
  await run(`document.querySelector('#resume-preview-box').open=true;true`);
  await capturePanel("#profile-panel", "02-界面-简历已导入.png");

  await setValue('[name="graduationDate"]', "2026-12-31");
  await setValue('[name="internshipAvailableFrom"]', "2026-09-15");
  await setValue('[name="industries"]', "Internet, FinTech");
  await setValue('[name="roleInterests"]', "Data Analyst");
  await setValue('[name="emphasizedSkills"]', "Python, SQL, data preprocessing");
  await run(`document.querySelector('#preferences-form').requestSubmit()`);
  await waitFor(
    () => run(`document.querySelector('#preferences-state').textContent`),
    (value) => value.includes("Saved locally"),
    { label: "preferences save" },
  );
  await capturePanel("#preferences-panel", "03-界面-求职偏好已保存.png");

  await setValue("#custom-roles", "Data Analyst");
  await click("#approve-roles");
  await waitFor(
    () => run(`document.querySelector('#approved-roles-state').textContent`),
    (value) => value.includes("Data Analyst"),
    { label: "role approval" },
  );
  await capturePanel("#markets-panel", "04-界面-岗位与市场已确认.png");

  await run(`(()=>{
    for(const e of document.querySelectorAll('input[name="markets"]'))e.checked=e.value==='SG';
    for(const e of document.querySelectorAll('input[name="employment"]'))e.checked=e.value==='internship';
    for(const e of document.querySelectorAll('input[name="sources"]'))e.checked=e.value==='sg-jobstreet';
    document.querySelector('#criteria-form').requestSubmit();
  })()`);
  await waitFor(
    () => run(`Number(document.querySelector('#metric-plan').textContent)`),
    (value) => value === 1,
    { label: "one-route search map" },
  );
  await capturePanel("#sources-panel", "05-界面-来源与搜索路线.png");

  await run(`document.querySelector('#auto-continue-search').checked=false;true`);
  await run(`window.confirm=()=>true;true`);
  await click("#discover");
  await waitFor(
    () =>
      run(
        `({disabled:document.querySelector('#discover').disabled,jobs:Number(document.querySelector('#metric-jobs').textContent),progress:document.querySelector('#scan-progress').textContent})`,
      ),
    (value) => !value.disabled && value.jobs > 0,
    { timeoutMs: 240000, label: "live lightweight discovery" },
  );

  const uiState = await run(
    `(()=>{const rows=[...document.querySelectorAll('#jobs-body .job-ledger-row')];const links=[...document.querySelectorAll('#jobs-body a')].map(a=>a.href);return {jobs:Number(document.querySelector('#metric-jobs').textContent),rows:rows.length,links,quality:document.querySelector('#job-quality-summary').textContent,progress:document.querySelector('#scan-progress').textContent};})()`,
  );
  assert.ok(uiState.jobs > 0, "The UI must display at least one live job");
  assert.ok(
    uiState.links.length > 0 && uiState.links.every((url) => url.startsWith("https://")),
    "Displayed jobs must have public HTTPS links",
  );

  const workspaceBeforeToggle = await (await fetch(`${origin}/api/workspaces/default`)).json();
  const recommendedCount = workspaceBeforeToggle.jobs.filter(
    (job) => job.reviewStatus !== "needs_review",
  ).length;
  const needsReviewCount = workspaceBeforeToggle.jobs.filter(
    (job) => job.reviewStatus === "needs_review",
  ).length;
  const fitCounts = Object.fromEntries(
    ["strong", "adjacent", "broad"].map((level) => [
      level,
      workspaceBeforeToggle.jobs.filter(
        (job) => job.reviewStatus !== "needs_review" && job.fitLevel === level,
      ).length,
    ]),
  );
  const dataNoteCount = workspaceBeforeToggle.jobs.filter(
    (job) => (job.dataWarnings ?? []).length,
  ).length;
  assert.equal(uiState.rows, recommendedCount, "The default UI must show only recommended jobs");
  assert.equal(recommendedCount + needsReviewCount, workspaceBeforeToggle.jobs.length);
  assert.match(
    uiState.quality,
    new RegExp(
      `Strong ${fitCounts.strong}.*Adjacent ${fitCounts.adjacent}.*Broad ${fitCounts.broad}.*Data notes ${dataNoteCount}.*Needs review ${needsReviewCount}`,
    ),
  );

  await run(
    `(()=>{const s=document.querySelector('#jobs-body select');if(!s)throw Error('Missing job status control');s.value='viewed';s.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  await waitFor(
    () => run(`document.querySelector('#jobs-body select')?.value`),
    (value) => value === "viewed",
    { label: "UI status update" },
  );

  const screenshotPath = await capturePanel("#jobs-panel", "06-界面-默认推荐职位与状态.png");
  await click("#show-needs-review");
  const reviewUiState = await run(
    `(()=>({rows:document.querySelectorAll('#jobs-body .job-ledger-row').length,flagged:document.querySelectorAll('#jobs-body .needs-review-row').length}))()`,
  );
  assert.equal(reviewUiState.rows, uiState.jobs, "The review toggle must expose every stored job");
  assert.equal(
    reviewUiState.flagged,
    needsReviewCount,
    "The review toggle must identify every quarantined job",
  );
  const reviewScreenshotPath = await capturePanel("#jobs-panel", "06B-界面-显示待复核记录.png");

  const downloadViaUi = (selector, savePath) =>
    new Promise(async (resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Excel download did not start")), 30000);
      mainWindow.webContents.session.once("will-download", (_event, item) => {
        clearTimeout(timeout);
        item.setSavePath(savePath);
        item.once("done", (_doneEvent, state) =>
          state === "completed" ? resolve() : reject(new Error(`Download ${state}`)),
        );
      });
      try {
        await click(selector);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    });
  const xlsxPath = path.join(root, "08-最终导出.xlsx");
  const csvPath = path.join(root, "08-最终导出.csv");
  await downloadViaUi('a[href$="/export.xlsx"]', xlsxPath);
  await downloadViaUi('a[href$="/export.csv"]', csvPath);

  const response = await fetch(`${origin}/api/workspaces/default`);
  assert.equal(response.status, 200);
  const workspace = await response.json();
  const task = workspace.searchPlan[0];
  const checkpoint = workspace.sourceCheckpoints[task.id];
  assert.ok(checkpoint.pagesRead >= 1);
  assert.equal(checkpoint.complete, false, "A bounded smoke run must not claim full coverage");
  assert.ok(
    ["page_limit", "pagination_unavailable", "pagination_loop", "job_results_not_ready"].includes(
      checkpoint.stopReason,
    ),
  );
  assert.equal(workspace.jobs.find((job) => job.id === workspace.jobs[0].id)?.status, "viewed");
  await writeFile(
    path.join(root, "07-标准化职位与搜索状态.json"),
    JSON.stringify(
      {
        synthetic: true,
        resume: workspace.resume,
        preferences: workspace.preferences,
        approvedRoles: workspace.approvedRoles,
        profile: workspace.profile,
        searchPlan: workspace.searchPlan,
        sourceCheckpoints: workspace.sourceCheckpoints,
        searchContinuation: workspace.searchContinuation,
        jobs: workspace.jobs,
      },
      null,
      2,
    ),
    "utf8",
  );
  output.lightweight = {
    sourceId: "sg-jobstreet",
    pagesRead: checkpoint.pagesRead,
    jobs: workspace.jobs.length,
    stopReason: checkpoint.stopReason,
    complete: checkpoint.complete,
    uiRows: uiState.rows,
    recommendedCount,
    needsReviewCount,
    fitCounts,
    dataNoteCount,
    reviewRows: reviewUiState.rows,
    httpsLinks: uiState.links.length,
    statusUpdate: "viewed",
    xlsxPath,
    csvPath,
    screenshotPath,
    reviewScreenshotPath,
  };
}

async function runFullSourceAcceptance() {
  const [task] = buildSearchPlan({
    markets: ["HK"],
    roleTitles: ["Data Analyst"],
    employmentTypes: ["full_time"],
    selectedSourceIds: ["hk-ies"],
  });
  const result = await controller.discover([task], { maxPages: 100, limitPerTask: 25 });
  const scan = result.scans.find((item) => item.taskId === task.id);
  assert.ok(scan, "A full-source scan record must be present");
  assert.equal(scan.complete, true, `Full-source scan did not finish: ${scan.stopReason}`);
  assert.equal(scan.stopReason, "last_page");
  assert.equal(scan.nextUrl, null);
  assert.ok(scan.pagesRead >= 1);
  assert.equal(result.pendingTasks.length, 0);
  assert.equal(result.failedTasks.length, 0);
  assert.equal(result.completedTaskIds.includes(task.id), true);
  output.fullSource = {
    sourceId: "hk-ies",
    query: task.query,
    pagesRead: scan.pagesRead,
    jobs: scan.uniqueJobs,
    stopReason: scan.stopReason,
    complete: scan.complete,
  };
  await writeFile(
    path.join(root, "09-iES代表性全量测试.json"),
    JSON.stringify(
      {
        boundary:
          "This verifies one source, query, and session; it is not a universal all-source claim.",
        task,
        result,
      },
      null,
      2,
    ),
    "utf8",
  );
}

app
  .whenReady()
  .then(async () => {
    await mkdir(root, { recursive: true });
    controller = createElectronSourceSessionController({
      BrowserWindow,
      session,
      shell,
      metadataRepository: createJsonFileRepository(path.join(root, "connections.json")),
    });
    const boundedController = {
      ...controller,
      discover: (tasks, options) => controller.discover(tasks, { ...options, maxPages: 2 }),
    };
    server = createCareerRadarServer({
      dataRoot: path.join(root, "workspace"),
      localModelProvider: null,
      sourceSessionController: boundedController,
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await writeFile(
      path.join(root, "01-测试输入.json"),
      JSON.stringify(
        {
          resumeText: output.syntheticProfile,
          graduationDate: "2026-12-31",
          internshipAvailableFrom: "2026-09-15",
          industries: ["Internet", "FinTech"],
          roleInterests: ["Data Analyst"],
          emphasizedSkills: ["Python", "SQL", "data preprocessing"],
          markets: ["SG"],
          employmentTypes: ["internship"],
          sources: ["sg-jobstreet"],
          uiAutoContinue: false,
          aiProviderCalled: false,
        },
        null,
        2,
      ),
      "utf8",
    );
    await runUiAcceptance(origin);
    await runFullSourceAcceptance();
    output.ok = true;
    await writeFile(path.join(root, "11-测试摘要.json"), JSON.stringify(output, null, 2), "utf8");
    app.quit();
  })
  .catch(async (error) => {
    output.error = { message: error.message, stack: error.stack };
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "11-测试摘要.json"), JSON.stringify(output, null, 2), "utf8");
    console.error(error);
    app.exit(1);
  });

// Developer-only: user enters credentials on the official site; verified access
// triggers actual adapter reading without a second confirmation button.
import { app, BrowserWindow, session, shell, dialog, Menu } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createElectronSourceSessionController } from "../src/desktop/source-sessions.js";
import { createJsonFileRepository } from "../src/store/json-file.js";
import { getSourceById } from "../src/sources/catalog.js";
import { disablePlatformPasskeyPrompt } from "../src/desktop/passkey-prompt.js";
import { summarizeAcceptance, acceptanceNextAction } from "./acceptance-result.mjs";
const root = process.env.CAREER_RADAR_AUDIT_ROOT;
if (!root || !path.isAbsolute(root)) throw Error("Isolated test root required");
app.setPath("userData", path.join(root, "browser"));
disablePlatformPasskeyPrompt(app.commandLine);
const ids = (process.env.CAREER_RADAR_LOGIN_SOURCES ?? "cn-shixiseng,sg-glints,cn-lagou").split(
  ",",
);
const maxPages = Number(process.env.CAREER_RADAR_LOGIN_PAGES ?? 1);
if (![1, 2].includes(maxPages) || ids.some((id) => !getSourceById(id)?.adapterId))
  throw Error("Invalid bounded login acceptance settings");
let main,
  controller,
  skip = false,
  closed = false,
  choice = null,
  startRequested = false;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const report = path.join(root, `login-queue-${Date.now()}.json`),
  results = [];
const escape = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;");
async function show(sourceId, message, needsDecision = false) {
  await writeFile(
    path.join(root, "login-queue-progress.json"),
    JSON.stringify({ sourceId, message, report }),
  );
  if (main.isDestroyed()) return;
  await main.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        `<meta charset="utf-8"><title>Career Radar — Source acceptance</title><style>body{font:18px system-ui;background:#f3f0e6;color:#173b40;padding:40px;line-height:1.7}a{display:inline-block;padding:12px;margin:8px;background:#173b40;color:white;border-radius:8px}</style><h1>Login & Read / 登录并验证读取</h1><h2>${escape(getSourceById(sourceId)?.name ?? "Results / 验收结果")}</h2><p>${escape(message)}</p><p>Enter credentials only in the official website window. / 只在官方网站窗口输入账号、密码或验证码，不要发送到聊天。</p><p>If Windows opens a "Choose a passkey" dialog over the form, cancel it; it blocks typing while open. / 如果 Windows 在表单上方弹出“选择通行密钥”，点取消即可，该窗口打开时无法输入。</p><p>Successful reading moves to the next source automatically. Failures stay here until you retry or skip; skipping is NOT a pass. / 读取通过后自动进入下一站；失败会停在这里，等你重试或跳过，跳过不算通过。</p><p>Keep the site window open during the test; it closes automatically afterwards. / 测试时保持网站窗口打开，完成后程序会自动关闭。</p>${sourceId ? `${needsDecision ? '<a href="https://career-radar.test/retry">Retry this source / 重试本渠道</a>' : '<a href="https://career-radar.test/start">Signed in — start reading / 已登录，开始读取</a>'}<a href="https://career-radar.test/skip">Skip (not passed) / 跳过（未通过）</a>` : ""}<hr><p>${results.map((r) => `${escape(r.sourceId)}: ${escape(r.reading ?? "not_passed")}, ${r.jobCount ?? 0} rows, ${escape(r.reason ?? "")}${r.userAction === "skip" ? " — skipped / 已跳过" : ""}`).join("<br>")}</p>`,
      ),
  );
}
app.on("before-quit", () => {
  closed = true;
  controller?.shutdown();
});
app
  .whenReady()
  .then(async () => {
    await mkdir(root, { recursive: true });
    main = new BrowserWindow({
      width: 950,
      height: 700,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    main.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    main.webContents.on("will-navigate", (e, url) => {
      e.preventDefault();
      if (url === "https://career-radar.test/skip") {
        skip = true;
        choice = "skip";
      }
      if (url === "https://career-radar.test/retry") choice = "retry";
      if (url === "https://career-radar.test/start") startRequested = true;
    });
    main.on("closed", () => {
      closed = true;
      app.quit();
    });
    for (let index = 0; index < ids.length; index++) {
      const sourceId = ids[index];
      if (closed) break;
      skip = false;
      choice = null;
      startRequested = false;
      const source = getSourceById(sourceId),
        row = { sourceId, checkedAt: new Date().toISOString() };
      controller = createElectronSourceSessionController({
        BrowserWindow,
        session,
        shell,
        dialog,
        Menu,
        metadataRepository: createJsonFileRepository(path.join(root, "connections.json")),
      });
      try {
        await show(
          sourceId,
          "Complete login or the security check; reading will continue automatically. / 请完成登录或网站验证，程序会自动继续。",
        );
        await controller.connect(source);
        let ready = false;
        const deadline = Date.now() + 300000;
        while (!skip && !closed && Date.now() < deadline) {
          const status = (await controller.list()).find((s) => s.sourceId === sourceId);
          // Several login sites show a first page to visitors, which looks "readable" before the
          // operator has signed in. For those, reading waits for a detected sign-in or the
          // operator's own "signed in, start reading" click.
          const signedIn =
            status?.authentication === "signed_in" ||
            (status?.authentication === "not_required" &&
              (source.access !== "login" || startRequested));
          if (status?.extraction === "ready" && signedIn && !status.lastFailure) {
            ready = true;
            break;
          }
          await pause(1500);
        }
        if (!ready) {
          row.reason = skip ? "user_skipped" : closed ? "closed" : "login_wait_expired";
          row.reading = "not_passed";
        } else {
          await show(
            sourceId,
            "Reading actual job pages now; no further click required. / 正在读取真实职位页面，无需再点击测试。",
          );
          const query = source.market === "CN" ? "数据分析" : "Data Analyst";
          const task = {
            id: `login-${sourceId}`,
            sourceId,
            query,
            searchUrl: source.searchUrl(query),
            market: source.market,
            employmentType: "full_time",
          };
          const result = await controller.discover([task], {
            maxPages,
            shouldStop: () => skip || closed,
          });
          Object.assign(row, summarizeAcceptance(result));
          row.jobCount = result.jobs.length;
          row.reason = result.failedTasks[0]?.code ?? result.pendingTasks[0]?.code ?? "last_page";
          await writeFile(
            path.join(root, `${sourceId}-login-sample.json`),
            JSON.stringify({ task, ...result }, null, 2),
          );
        }
      } catch (error) {
        row.reason = error.code ?? error.name;
        row.reading = "failed";
      }
      results.push(row);
      await writeFile(report, JSON.stringify(results, null, 2));
      if (!closed && acceptanceNextAction(row, choice) === "wait") {
        await show(
          sourceId,
          `Not passed: ${row.reason}. Retry after completing the website step, or explicitly skip. / 未通过：${row.reason}。完成网站操作后重试，或明确跳过。`,
          true,
        );
        while (!closed && !choice) await pause(500);
      }
      row.userAction = choice ?? (closed ? "closed" : "auto_next");
      await writeFile(report, JSON.stringify(results, null, 2));
      controller.shutdown();
      controller = null;
      if (choice === "retry") index--;
    }
    if (!closed)
      await show(
        null,
        "Results saved. Account-dependent failures remain explicit; no automatic applications were sent. / 测试结果已保存，需要账号处理的渠道会明确记录；没有自动投递。",
      );
  })
  .catch((error) => {
    console.error(error.name);
    app.exit(1);
  });

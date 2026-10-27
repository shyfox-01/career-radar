import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { app, BrowserWindow, dialog, Menu, session, shell } from "electron";

import { createCareerRadarServer } from "../server.js";
import { classifyNavigation } from "./navigation.js";
import { resolveDesktopDataRoot } from "./paths.js";
import { createJsonFileRepository } from "../store/json-file.js";
import { createElectronSourceSessionController } from "./source-sessions.js";
import { disablePlatformPasskeyPrompt } from "./passkey-prompt.js";

disablePlatformPasskeyPrompt(app.commandLine);

let server;
let mainWindow;
const isSmokeTest = process.argv.includes("--smoke-test");

async function openExternalSafely(target, origin) {
  if (classifyNavigation(target, origin) === "external") {
    await shell.openExternal(target);
  }
}

async function createMainWindow() {
  const accessToken = randomBytes(32).toString("base64url");
  const dataRoot = resolveDesktopDataRoot({
    configuredRoot: process.env.CAREER_RADAR_DATA_DIR,
    portableDirectory: process.env.PORTABLE_EXECUTABLE_DIR,
    userDataDirectory: app.getPath("userData"),
  });
  const sourceSessionController = createElectronSourceSessionController({
    BrowserWindow,
    session,
    shell,
    dialog,
    Menu,
    metadataRepository: createJsonFileRepository(path.join(dataRoot, "source-connections.json")),
  });
  app.on("before-quit", () => sourceSessionController.shutdown());
  server = createCareerRadarServer({
    accessToken,
    dataRoot,
    sourceSessionController,
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#f3f0e6",
    show: false,
    title: "Career Radar",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  await mainWindow.webContents.session.cookies.set({
    url: origin,
    name: "career_radar_session",
    value: accessToken,
    httpOnly: true,
    sameSite: "strict",
    secure: false,
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalSafely(url, origin);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (classifyNavigation(url, origin) !== "internal") {
      event.preventDefault();
      void openExternalSafely(url, origin);
    }
  });
  if (!isSmokeTest) {
    mainWindow.once("ready-to-show", () => mainWindow.show());
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
    sourceSessionController.shutdown();
    app.quit();
  });
  await mainWindow.loadURL(origin);
  if (isSmokeTest) {
    if (process.env.CAREER_RADAR_SMOKE_MARKER) {
      await writeFile(
        process.env.CAREER_RADAR_SMOKE_MARKER,
        JSON.stringify({ ok: true, origin, dataRoot }, null, 2),
        "utf8",
      );
    }
    console.log(`CAREER_RADAR_SMOKE_OK ${origin}`);
    app.quit();
  }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  app
    .whenReady()
    .then(createMainWindow)
    .catch((error) => {
      dialog.showErrorBox("Career Radar could not start", error.message);
      app.quit();
    });
}

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (server?.listening) server.close();
});

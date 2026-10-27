import { getLoginSource, sourceConnectionView } from "../sources/connections.js";
import { SOURCE_CATALOG } from "../sources/catalog.js";
import { createSourceAdapterRegistry } from "../sources/adapters/registry.js";
import { attachLoginHealth, sourceLoginUrl } from "./login-health.js";
import { watchSourceLogin } from "./auto-connect.js";
import { retainSourceWindow } from "./source-window-lifecycle.js";

function sourceRoot(url) {
  const host = new URL(url).hostname.toLocaleLowerCase("en").replace(/\.$/u, "");
  return host.startsWith("www.") ? host.slice(4) : host;
}

export function createSourceSessionPolicy(source, adapterRegistry = createSourceAdapterRegistry()) {
  const validated = getLoginSource(source?.id);
  const adapter = adapterRegistry.get(validated.id);
  const allowedRoots = [
    ...new Set([
      sourceRoot(validated.evidenceUrl),
      sourceRoot(validated.searchUrl("Career Radar")),
    ]),
  ].sort();
  const allowedHosts = [...new Set(adapter?.navigationHosts ?? [])].sort();
  return Object.freeze({
    sourceId: validated.id,
    partition: `persist:career-radar-source-${validated.id}`,
    allowedRoots: Object.freeze(allowedRoots),
    allowedHosts: Object.freeze(allowedHosts),
  });
}

export function classifySourceNavigation(policy, target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return "blocked";
  }
  if (url.protocol !== "https:") return "blocked";
  const host = url.hostname.toLocaleLowerCase("en").replace(/\.$/u, "");
  if (policy.allowedHosts?.includes(host)) return "internal";
  if (policy.allowedRoots.some((root) => host === root || host.endsWith(`.${root}`))) {
    return "internal";
  }
  return "external";
}

export function createElectronSourceSessionController({
  BrowserWindow,
  session,
  shell,
  dialog,
  Menu,
  metadataRepository,
  adapterRegistry = createSourceAdapterRegistry(),
  now = () => new Date().toISOString(),
  pageLoadTimeoutMs = 35_000,
  domReadyGraceMs = 10_000,
}) {
  if (
    !BrowserWindow ||
    !session?.fromPartition ||
    !shell?.openExternal ||
    !metadataRepository?.load ||
    !metadataRepository?.save
  ) {
    throw new TypeError(
      "Electron source sessions need window, session, shell, and metadata boundaries",
    );
  }
  const windows = new Map();
  const allSourceWindows = new Set();
  let quitting = false;
  const loginWatchers = new WeakMap();
  const operations = new Map();
  let metadataWrite = Promise.resolve();

  // Some sites never fire their load event: an image or a sign-in polling request hangs
  // although the document and its job list are ready, and the page will not run reader
  // scripts until loading ends. Once the document is parsed, a grace period passes and the
  // remaining tail is stopped, as a person would press Stop; readers then poll for cards.
  async function loadPage(window, target) {
    let timer, grace, onDomReady;
    const loading = window.loadURL(target);
    loading.catch(() => {});
    // Both timers can be what settles the load, so they keep the process alive; the
    // finally block clears them as soon as the load settles either way.
    try {
      return await Promise.race([
        loading,
        new Promise((resolve, reject) => {
          onDomReady = () => {
            grace = setTimeout(() => {
              window.webContents.stop?.();
              resolve();
            }, domReadyGraceMs);
          };
          window.webContents.once?.("dom-ready", onDomReady);
          timer = setTimeout(() => {
            window.webContents.stop?.();
            const error = new Error("Page load timed out / 页面加载超时，可重试");
            error.code = "page_load_timeout";
            reject(error);
          }, pageLoadTimeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      clearTimeout(grace);
      if (onDomReady) window.webContents.removeListener?.("dom-ready", onDomReady);
    }
  }

  async function withSource(sourceId, operation) {
    const previous = operations.get(sourceId) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    operations.set(sourceId, current);
    try {
      return await current;
    } finally {
      if (operations.get(sourceId) === current) operations.delete(sourceId);
    }
  }

  async function saveRecord(sourceId, patch) {
    const write = metadataWrite
      .catch(() => {})
      .then(async () => {
        const records = await metadataRepository.load();
        records[sourceId] = { ...(records[sourceId] ?? {}), ...patch };
        await metadataRepository.save(records);
        return records[sourceId];
      });
    metadataWrite = write;
    return write;
  }

  async function createWindow(source, target) {
    const policy = createSourceSessionPolicy(source, adapterRegistry);
    const webPreferences = {
      partition: policy.partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    };
    const window = new BrowserWindow({
      width: 1180,
      height: 820,
      minWidth: 760,
      minHeight: 560,
      title: `${source.name} — Career Radar Login`,
      webPreferences,
    });

    function guardNavigation(targetWindow) {
      allSourceWindows.add(targetWindow);
      retainSourceWindow(
        targetWindow,
        () => quitting,
        () => operations.has(source.id),
        () => {
          void dialog?.showMessageBox?.(targetWindow, {
            type: "info",
            title: "Reading in progress / 正在读取",
            message:
              "Keep this window open while reading. Return to Career Radar to pause the search. / 读取期间请保持此窗口打开；可返回 Career Radar 暂停搜索。",
          });
        },
      );
      targetWindow.on("closed", () => allSourceWindows.delete(targetWindow));
      const adapter = adapterRegistry.get(source.id);
      if (adapter?.inspect)
        loginWatchers.set(
          targetWindow,
          watchSourceLogin({
            window: targetWindow,
            isBusy: () => operations.has(source.id),
            inspect: () => adapter.inspect({ driver: driverFor(source, targetWindow), source }),
            onSignedIn: async (detected) => {
              try {
                await probeSource(source.id);
              } catch {
                if (window.isDestroyed() || windows.get(source.id) !== window) return;
                await saveRecord(source.id, {
                  state: "connected_unverified",
                  authentication: detected.authentication,
                  extraction: "unknown",
                  lastFailure: {
                    code: "automatic_connection_pending",
                    message:
                      "Access detected; automatic reading needs a retry. / 已检测到访问状态，自动读取尚需重试。",
                  },
                });
              }
            },
          }),
        );
      const health = attachLoginHealth({
        window: targetWindow,
        source,
        dialog,
        Menu,
        onFailure: async (failure) => {
          await saveRecord(source.id, {
            state: "needs_repair",
            authentication: "unknown",
            extraction: "unknown",
            lastFailure: failure,
            lastLoginFailureAt: now(),
          });
        },
        recover: async (destination) => {
          if (destination) {
            await window.loadURL(destination);
            window.focus();
            if (targetWindow !== window && !targetWindow.isDestroyed()) targetWindow.close();
          } else {
            targetWindow.webContents.reload?.();
          }
        },
      });
      targetWindow.webContents.setWindowOpenHandler(({ url }) => {
        const disposition = classifySourceNavigation(policy, url);
        const safeBlank =
          url === "about:blank" &&
          classifySourceNavigation(policy, targetWindow.webContents.getURL?.()) === "internal";
        if (disposition === "internal" || safeBlank) {
          return {
            action: "allow",
            overrideBrowserWindowOptions: { webPreferences },
          };
        }
        if (disposition === "external") void shell.openExternal(url);
        return { action: "deny" };
      });
      targetWindow.webContents.on("will-navigate", (event, url) => {
        const disposition = classifySourceNavigation(policy, url);
        if (disposition === "internal") return;
        event.preventDefault();
        void health.report("login_navigation_blocked", url).catch(() => {});
        if (disposition === "external") void shell.openExternal(url);
      });
      targetWindow.webContents.on("did-create-window", (childWindow) => {
        guardNavigation(childWindow);
      });
    }

    guardNavigation(window);
    window.on("closed", () => windows.delete(source.id));
    windows.set(source.id, window);
    try {
      await loadPage(window, target);
    } catch (error) {
      const currentUrl = window.webContents.getURL?.() ?? "";
      if (
        ["ERR_ABORTED", "page_load_timeout"].includes(error?.code) &&
        classifySourceNavigation(policy, currentUrl) === "internal"
      ) {
        return window;
      }
      // did-fail-load presents a retry action; propagate a credential-free error.
      const rawCode = String(error?.code ?? "");
      const code =
        /^ERR_[A-Z_]{1,60}$/.test(rawCode) || rawCode === "page_load_timeout"
          ? rawCode
          : "source_load_failed";
      const guidance =
        code === "ERR_NAME_NOT_RESOLVED"
          ? "Website address could not be resolved; check the connection. / 无法解析网站地址，请检查网络连接。"
          : code === "page_load_timeout" || code === "ERR_TIMED_OUT"
            ? "Page load timed out; retry this source. / 页面加载超时，请重试此渠道。"
            : "Page could not load; use Sign-in Help in its window. / 页面未加载，请使用窗口顶部的登录帮助。";
      throw Object.assign(new Error(`${source.name}: ${guidance} [${code}]`), { code });
    }
    return window;
  }

  async function openWindow(source, target) {
    const policy = createSourceSessionPolicy(source, adapterRegistry);
    if (classifySourceNavigation(policy, target) !== "internal") {
      throw new TypeError("Source URL must be a public HTTPS page on the selected source domain");
    }
    const existing = windows.get(source.id);
    if (existing && !existing.isDestroyed()) {
      await loadPage(existing, target);
      existing.show?.();
      existing.focus();
    } else {
      await createWindow(source, target);
    }
    return saveRecord(source.id, { lastOpenedAt: now(), lastUrl: target });
  }

  function driverFor(source, targetWindow = windows.get(source.id)) {
    const window = targetWindow;
    if (!window || window.isDestroyed()) {
      throw new TypeError(`Open the ${source.name} connection before probing it`);
    }
    const policy = createSourceSessionPolicy(source, adapterRegistry);
    return Object.freeze({
      async navigate(target) {
        if (classifySourceNavigation(policy, target) !== "internal") {
          throw new TypeError("Adapter navigation must stay on the selected source domain");
        }
        await loadPage(window, target);
      },
      async waitForReady() {
        // BrowserWindow.loadURL resolves after the main page finishes loading.
      },
      async snapshot(script) {
        if (typeof script !== "string" || !script.trim()) {
          throw new TypeError("Adapter snapshot script must be non-empty");
        }
        return window.webContents.executeJavaScript(script, true);
      },
      async act(script) {
        return window.webContents.executeJavaScript(script, true);
      },
    });
  }

  function stateForCapability(capability) {
    if (
      ["signed_in", "not_required"].includes(capability.authentication) &&
      capability.extraction === "ready"
    )
      return "connected";
    if (capability.authentication === "challenge" || capability.extraction === "blocked")
      return "needs_repair";
    return "connected_unverified";
  }

  async function probeSource(sourceId) {
    return withSource(sourceId, () => performProbe(sourceId));
  }

  async function performProbe(sourceId) {
    const source = getLoginSource(sourceId);
    const adapter = adapterRegistry.get(sourceId);
    if (!adapter)
      throw new TypeError(`${source.name} does not have an automatic extraction adapter yet`);
    if (!windows.get(sourceId) || windows.get(sourceId).isDestroyed()) {
      await openWindow(source, source.evidenceUrl);
    }
    const verifiedWindow = windows.get(sourceId);
    const capability = await adapter.probe({ driver: driverFor(source), source });
    if (verifiedWindow.isDestroyed() || windows.get(sourceId) !== verifiedWindow) {
      throw new Error("Source window was closed before connection completed");
    }
    const updated = await saveRecord(sourceId, {
      adapterId: adapter.id,
      authentication: capability.authentication,
      extraction: capability.extraction,
      probeResultCount: capability.resultCount,
      state: stateForCapability(capability),
      lastProbedAt: now(),
      lastFailure: capability.reason
        ? {
            code: capability.reason,
            message:
              capability.reason === "job_results_not_ready"
                ? "Signed in, but readable job cards have not appeared yet. / 已登录，但尚未读取到可解析的职位卡片。"
                : capability.reason,
          }
        : null,
    });
    if (
      ["signed_in", "not_required"].includes(capability.authentication) &&
      capability.extraction === "ready"
    ) {
      for (const target of allSourceWindows)
        if (target.webContents.session === verifiedWindow.webContents.session) target.hide?.();
    }
    return sourceConnectionView(source, updated, true);
  }

  return Object.freeze({
    async list() {
      const records = await metadataRepository.load();
      return SOURCE_CATALOG.filter((source) => source.access === "login" || source.adapterId).map(
        (source) => sourceConnectionView(source, records[source.id], true),
      );
    },
    async connect(source) {
      const record = await openWindow(source, sourceLoginUrl(source));
      const updated = await saveRecord(source.id, { ...record, state: "connected_unverified" });
      loginWatchers.get(windows.get(source.id))?.restart();
      return sourceConnectionView(source, updated, true);
    },
    async confirm(sourceId) {
      const source = getLoginSource(sourceId);
      const records = await metadataRepository.load();
      if (!records[sourceId]) throw new TypeError("Open the source login window before confirming");
      if (adapterRegistry.get(sourceId)) return probeSource(sourceId);
      const updated = await saveRecord(sourceId, {
        state: "connected",
        lastConfirmedAt: now(),
      });
      return sourceConnectionView(source, updated, true);
    },
    async probe(sourceId) {
      return probeSource(sourceId);
    },
    async discover(
      tasks,
      {
        limitPerTask = 25,
        maxPages = 20,
        onProgress = async () => {},
        shouldStop = () => false,
      } = {},
    ) {
      if (!Array.isArray(tasks)) throw new TypeError("Source adapter tasks must be an array");
      const jobs = [];
      const completedTaskIds = [];
      const failedTasks = [];
      const unsupportedTaskIds = [];
      const pendingTasks = [];
      const blockedSources = new Map();
      const scans = [];
      for (const task of tasks) {
        if (blockedSources.has(task.sourceId)) {
          pendingTasks.push({
            taskId: task.id,
            sourceId: task.sourceId,
            code: blockedSources.get(task.sourceId),
          });
          continue;
        }
        if (shouldStop()) {
          pendingTasks.push({ taskId: task.id, sourceId: task.sourceId, code: "cancelled" });
          continue;
        }
        const source = getLoginSource(task?.sourceId);
        const adapter = adapterRegistry.get(source.id);
        if (!adapter) {
          unsupportedTaskIds.push(task.id);
          continue;
        }
        try {
          if (!windows.get(source.id) || windows.get(source.id).isDestroyed()) {
            await openWindow(source, source.evidenceUrl);
          }
          windows.get(source.id)?.showInactive?.();
          const result = await withSource(source.id, () =>
            adapter.discover({
              driver: driverFor(source),
              source,
              task,
              limit: limitPerTask,
              maxPages,
              shouldStop,
              onProgress: async (progress) => {
                await saveRecord(source.id, {
                  scan: { taskId: task.id, ...progress.scan },
                  lastScanAt: now(),
                });
                await onProgress(task, progress);
              },
            }),
          );
          jobs.push(...result.jobs);
          if (result.scan) {
            scans.push({ taskId: task.id, sourceId: source.id, ...result.scan });
          }
          if (result.scan && !result.scan.complete) {
            pendingTasks.push({
              taskId: task.id,
              sourceId: source.id,
              code: result.scan.stopReason,
              nextUrl: result.scan.nextUrl,
            });
            if (result.scan.stopReason !== "page_limit")
              blockedSources.set(source.id, result.scan.stopReason);
          } else completedTaskIds.push(task.id);
          await saveRecord(source.id, {
            adapterId: adapter.id,
            authentication: result.capability.authentication,
            extraction: result.capability.extraction,
            state: stateForCapability(result.capability),
            lastProbedAt: now(),
            lastSuccessfulExtractionAt: now(),
            lastFailure: result.capability.reason
              ? { code: result.capability.reason, message: result.capability.reason }
              : null,
          });
          if (["signed_in", "not_required"].includes(result.capability?.authentication))
            windows.get(source.id)?.hide?.();
          else {
            windows.get(source.id)?.show?.();
            loginWatchers.get(windows.get(source.id))?.restart();
          }
        } catch (error) {
          const capability = error?.details?.capability;
          const failure = {
            taskId: task.id,
            sourceId: source.id,
            code: typeof error?.code === "string" ? error.code : "adapter_failed",
            message: error?.message ?? "Source adapter failed",
          };
          failedTasks.push(failure);
          blockedSources.set(source.id, failure.code);
          await saveRecord(source.id, {
            adapterId: adapter.id,
            authentication: capability?.authentication ?? "unknown",
            extraction: capability?.extraction ?? "unknown",
            state: capability ? stateForCapability(capability) : "needs_repair",
            lastProbedAt: now(),
            lastFailure: { code: failure.code, message: failure.message },
          });
          if (
            capability?.authentication === "signed_out" ||
            capability?.authentication === "challenge"
          ) {
            windows.get(source.id)?.show?.();
            loginWatchers.get(windows.get(source.id))?.restart();
          }
        }
      }
      return { jobs, completedTaskIds, failedTasks, unsupportedTaskIds, pendingTasks, scans };
    },
    async open(source, url) {
      const current = windows.get(source.id);
      if (operations.has(source.id) && current && !current.isDestroyed()) {
        current.show?.();
        current.focus();
        return {
          ...sourceConnectionView(source, (await metadataRepository.load())[source.id], true),
          url: current.webContents.getURL?.(),
        };
      }
      const updated = await openWindow(source, url);
      return { ...sourceConnectionView(source, updated, true), url };
    },
    async disconnect(sourceId) {
      const source = getLoginSource(sourceId);
      const policy = createSourceSessionPolicy(source, adapterRegistry);
      const window = windows.get(sourceId);
      if (window && !window.isDestroyed()) {
        for (const target of [...allSourceWindows])
          if (target.webContents.session === window.webContents.session) target.destroy();
      }
      await session.fromPartition(policy.partition).clearStorageData();
      const removal = metadataWrite
        .catch(() => {})
        .then(async () => {
          const records = await metadataRepository.load();
          delete records[sourceId];
          await metadataRepository.save(records);
        });
      metadataWrite = removal;
      await removal;
      return sourceConnectionView(source, {}, true);
    },
    shutdown() {
      quitting = true;
      for (const window of allSourceWindows) if (!window.isDestroyed()) window.destroy();
    },
  });
}

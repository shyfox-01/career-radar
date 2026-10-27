import test from "node:test";
import assert from "node:assert/strict";

import {
  classifySourceNavigation,
  createElectronSourceSessionController,
  createSourceSessionPolicy,
} from "../src/desktop/source-sessions.js";
import { getSourceById } from "../src/sources/catalog.js";

test("source load errors preserve actionable network codes without leaking sign-in URLs", async () => {
  for (const [rawCode, expected] of [
    ["ERR_NAME_NOT_RESOLVED", "ERR_NAME_NOT_RESOLVED"],
    ["page_load_timeout", "page_load_timeout"],
    ["token=PRIVATE", "source_load_failed"],
  ]) {
    class FailedWindow {
      constructor() {
        this.destroyed = false;
        this.webContents = { on() {}, setWindowOpenHandler() {}, getURL: () => "" };
      }
      on() {}
      isDestroyed() {
        return this.destroyed;
      }
      destroy() {
        this.destroyed = true;
      }
      async loadURL() {
        throw Object.assign(new Error("https://example.test/login?token=PRIVATE"), {
          code: rawCode,
        });
      }
    }
    const controller = createElectronSourceSessionController({
      BrowserWindow: FailedWindow,
      session: { fromPartition: () => ({}) },
      shell: { openExternal: async () => {} },
      adapterRegistry: { get: () => null },
      metadataRepository: { load: async () => ({}), save: async () => {} },
    });
    try {
      await assert.rejects(controller.connect(getSourceById("cn-zhipin")), (error) => {
        assert.equal(error.code, expected);
        assert.doesNotMatch(error.message, /PRIVATE|token=/);
        return true;
      });
    } finally {
      controller.shutdown();
    }
  }
});

test("source login keeps checking an internal page after a replaced or incomplete load", async () => {
  for (const loadCode of ["ERR_ABORTED", "page_load_timeout"]) {
    let persisted = {};
    class RedirectingWindow {
      constructor() {
        this.handlers = new Map();
        this.webContents = {
          on() {},
          setWindowOpenHandler() {},
          getURL: () => "https://www.shixiseng.com/interns",
        };
      }
      on(name, handler) {
        this.handlers.set(name, handler);
      }
      isDestroyed() {
        return false;
      }
      destroy() {}
      async loadURL() {
        throw Object.assign(new Error("source page remained available"), { code: loadCode });
      }
    }
    const controller = createElectronSourceSessionController({
      BrowserWindow: RedirectingWindow,
      session: { fromPartition: () => ({ async clearStorageData() {} }) },
      shell: { openExternal: async () => {} },
      adapterRegistry: { get: () => null },
      metadataRepository: {
        async load() {
          return structuredClone(persisted);
        },
        async save(value) {
          persisted = structuredClone(value);
        },
      },
    });
    try {
      const connected = await controller.connect(getSourceById("cn-shixiseng"));
      assert.equal(connected.state, "connected_unverified");
    } finally {
      controller.shutdown();
    }
  }
});

test("a parsed page whose load event never fires is stopped and used after a short grace period", async () => {
  const stops = [];
  class HangingWindow {
    constructor() {
      this.webContents = {
        on() {},
        setWindowOpenHandler() {},
        getURL: () => "https://www.shixiseng.com/interns",
        stop() {
          stops.push(Date.now());
        },
        once(name, handler) {
          if (name === "dom-ready") setTimeout(handler, 5);
        },
        removeListener() {},
      };
    }
    on() {}
    isDestroyed() {
      return false;
    }
    destroy() {}
    loadURL() {
      return new Promise(() => {});
    }
  }
  const controller = createElectronSourceSessionController({
    BrowserWindow: HangingWindow,
    session: { fromPartition: () => ({ async clearStorageData() {} }) },
    shell: { openExternal: async () => {} },
    adapterRegistry: { get: () => null },
    metadataRepository: { load: async () => ({}), save: async () => {} },
    pageLoadTimeoutMs: 60_000,
    domReadyGraceMs: 20,
  });
  try {
    const started = Date.now();
    const connected = await controller.connect(getSourceById("cn-shixiseng"));
    assert.equal(connected.state, "connected_unverified");
    assert.ok(Date.now() - started < 5_000);
    assert.equal(stops.length, 1);
  } finally {
    controller.shutdown();
  }
});

test("source session policy creates a deterministic isolated partition", () => {
  const policy = createSourceSessionPolicy(getSourceById("cn-zhipin"));
  assert.equal(policy.partition, "persist:career-radar-source-cn-zhipin");
  assert.deepEqual(policy.allowedRoots, ["zhipin.com"]);
  assert.equal(
    classifySourceNavigation(policy, "https://www.zhipin.com/web/geek/jobs"),
    "internal",
  );
  assert.equal(classifySourceNavigation(policy, "https://passport.zhipin.com/login"), "internal");
  assert.equal(
    classifySourceNavigation(policy, "https://zhipin.com.attacker.example/"),
    "external",
  );
  assert.equal(classifySourceNavigation(policy, "file:///C:/secret.txt"), "blocked");
});

test("LinkedIn session policy permits only the exact Google OAuth host", () => {
  const policy = createSourceSessionPolicy(getSourceById("sg-linkedin"));
  assert.equal(policy.partition, "persist:career-radar-source-sg-linkedin");
  assert.deepEqual(policy.allowedRoots, ["linkedin.com"]);
  assert.deepEqual(policy.allowedHosts, ["accounts.google.com"]);
  assert.equal(
    classifySourceNavigation(policy, "https://accounts.google.com/o/oauth2/v2/auth"),
    "internal",
  );
  assert.equal(classifySourceNavigation(policy, "https://google.com/"), "external");
  assert.equal(classifySourceNavigation(policy, "https://mail.google.com/"), "external");
  assert.equal(
    classifySourceNavigation(policy, "https://accounts.google.com.attacker.example/"),
    "external",
  );
  assert.equal(classifySourceNavigation(policy, "http://accounts.google.com/"), "blocked");
});

test("LinkedIn Google OAuth popup inherits the isolated sandboxed session", async () => {
  let persisted = {};
  const windows = [];

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.handlers = new Map();
      this.webContentsHandlers = new Map();
      this.webContents = {
        getURL: () => "https://www.linkedin.com/login",
        setWindowOpenHandler: (handler) => {
          this.openHandler = handler;
        },
        on: (name, handler) => {
          this.webContentsHandlers.set(name, handler);
        },
      };
      windows.push(this);
    }
    async loadURL() {}
    on(name, handler) {
      this.handlers.set(name, handler);
    }
    isDestroyed() {
      return false;
    }
    focus() {}
    close() {
      this.handlers.get("closed")?.();
    }
  }

  const controller = createElectronSourceSessionController({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => ({ async clearStorageData() {} }) },
    shell: { async openExternal() {} },
    metadataRepository: {
      async load() {
        return structuredClone(persisted);
      },
      async save(value) {
        persisted = structuredClone(value);
      },
    },
  });

  await controller.connect(getSourceById("sg-linkedin"));
  const popup = windows[0].openHandler({
    url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=linkedin",
  });
  assert.equal(popup.action, "allow");
  assert.deepEqual(popup.overrideBrowserWindowOptions.webPreferences, {
    partition: "persist:career-radar-source-sg-linkedin",
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: false,
  });

  const child = new FakeBrowserWindow(popup.overrideBrowserWindowOptions);
  windows[0].webContentsHandlers.get("did-create-window")(child);
  assert.equal(typeof child.openHandler, "function");
  assert.equal(typeof child.webContentsHandlers.get("will-navigate"), "function");
  assert.deepEqual(child.openHandler({ url: "https://evil.example/" }), { action: "deny" });
  assert.equal(windows[0].openHandler({ url: "about:blank" }).action, "allow");
  child.webContents.getURL = () => "https://evil.example/";
  assert.equal(child.openHandler({ url: "about:blank" }).action, "deny");
});

test("Electron controller opens a sandboxed source window and exposes no cookies", async () => {
  const windows = [];
  const openedExternal = [];
  const sessions = new Map();
  let persisted = {};

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.handlers = new Map();
      this.loaded = [];
      this.destroy = () => {
        this.handlers.get("closed")?.();
      };
      this.webContents = {
        executeJavaScript: async () => ({
          cards: [
            {
              title: "Data Analyst",
              company: "Example",
              url: "https://www.zhipin.com/job_detail/example.html",
            },
          ],
          challenge: false,
          login: false,
        }),
        setWindowOpenHandler: (handler) => {
          this.openHandler = handler;
        },
        on: (name, handler) => {
          this.handlers.set(name, handler);
        },
      };
      windows.push(this);
    }
    async loadURL(url) {
      this.loaded.push(url);
    }
    on(name, handler) {
      this.handlers.set(name, handler);
    }
    isDestroyed() {
      return false;
    }
    focus() {}
    close() {
      this.handlers.get("closed")?.();
    }
  }

  const controller = createElectronSourceSessionController({
    BrowserWindow: FakeBrowserWindow,
    session: {
      fromPartition(partition) {
        if (!sessions.has(partition)) {
          sessions.set(partition, {
            cleared: 0,
            async clearStorageData() {
              this.cleared += 1;
            },
          });
        }
        return sessions.get(partition);
      },
    },
    shell: {
      async openExternal(url) {
        openedExternal.push(url);
      },
    },
    metadataRepository: {
      async load() {
        return structuredClone(persisted);
      },
      async save(value) {
        persisted = structuredClone(value);
      },
    },
    now: () => "2026-09-07T08:00:00.000Z",
  });

  const connected = await controller.connect(getSourceById("cn-zhipin"));
  assert.equal(connected.state, "connected_unverified");
  assert.equal(windows.length, 1);
  assert.deepEqual(windows[0].options.webPreferences, {
    partition: "persist:career-radar-source-cn-zhipin",
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    backgroundThrottling: false,
  });
  assert.equal(JSON.stringify(connected).includes("cookie"), false);
  assert.equal(JSON.stringify(persisted).includes("cookie"), false);

  const popup = windows[0].openHandler({ url: "https://evil.example/" });
  assert.deepEqual(popup, { action: "deny" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(openedExternal, ["https://evil.example/"]);

  const confirmed = await controller.confirm("cn-zhipin");
  assert.equal(confirmed.state, "connected");
  assert.equal(confirmed.authentication, "not_required");
  assert.equal(confirmed.extraction, "ready");
  await controller.disconnect("cn-zhipin");
  assert.equal(sessions.get("persist:career-radar-source-cn-zhipin").cleared, 1);
  assert.equal(Object.hasOwn(persisted, "cn-zhipin"), false);
});

test("Electron controller proves LinkedIn authentication and extraction before discovery", async () => {
  let persisted = {};
  const snapshot = {
    url: "https://www.linkedin.com/jobs/search/?keywords=Data%20Engineer&location=Singapore",
    title: "Data Engineer Jobs in Singapore | LinkedIn",
    bodyText: "Jobs My Network Messaging Notifications",
    pagination: { nextUrl: null, endConfirmed: true },
    markers: { authenticated: 2, signedOut: 0, challenge: 0, searchSurface: 1 },
    cards: [
      {
        title: "Data Engineer Intern",
        company: "Example Labs",
        location: "Singapore",
        url: "https://www.linkedin.com/jobs/view/1234567890/?trackingId=secret",
        postedText: "2 days ago",
        description: "Build Python and SQL data pipelines.",
      },
    ],
  };

  class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.handlers = new Map();
      this.currentUrl = "";
      this.webContents = {
        setWindowOpenHandler: () => {},
        on: () => {},
        getURL: () => this.currentUrl,
        executeJavaScript: async (script) => {
          if (script.includes("scrollTop")) return { atEnd: true, moved: false };
          assert.match(script, /jobs\/view/iu);
          return structuredClone(snapshot);
        },
      };
    }
    async loadURL(url) {
      this.currentUrl = url;
    }
    on(name, handler) {
      this.handlers.set(name, handler);
    }
    isDestroyed() {
      return false;
    }
    focus() {}
    close() {
      this.handlers.get("closed")?.();
    }
  }

  const controller = createElectronSourceSessionController({
    BrowserWindow: FakeBrowserWindow,
    session: { fromPartition: () => ({ async clearStorageData() {} }) },
    shell: { async openExternal() {} },
    metadataRepository: {
      async load() {
        return structuredClone(persisted);
      },
      async save(value) {
        persisted = structuredClone(value);
      },
    },
    now: () => "2026-09-07T10:00:00.000Z",
  });

  await controller.connect(getSourceById("sg-linkedin"));
  const probed = await controller.probe("sg-linkedin");
  assert.equal(probed.state, "connected");
  assert.equal(probed.adapterId, "linkedin");
  assert.equal(probed.authentication, "signed_in");
  assert.equal(probed.extraction, "ready");
  assert.equal(probed.lastProbedAt, "2026-09-07T10:00:00.000Z");
  assert.equal(probed.probeResultCount, 1);

  const task = {
    id: "SG:sg-linkedin:dynamic:internship:Data Engineer",
    sourceId: "sg-linkedin",
    market: "SG",
    employmentType: "internship",
    searchUrl: snapshot.url,
  };
  const result = await controller.discover([task]);
  assert.deepEqual(result.completedTaskIds, [task.id]);
  assert.deepEqual(result.failedTasks, []);
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].url, "https://www.linkedin.com/jobs/view/1234567890");
  assert.equal(persisted["sg-linkedin"].lastSuccessfulExtractionAt, "2026-09-07T10:00:00.000Z");
});

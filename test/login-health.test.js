import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { attachLoginHealth, loginFailure, sourceLoginUrl } from "../src/desktop/login-health.js";

const source = {
  id: "sg-linkedin",
  name: "LinkedIn",
  evidenceUrl: "https://www.linkedin.com/jobs/",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(health = { blank: false }) {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.webContents.getURL = () => "https://accounts.google.com/signin?secret=do-not-log";
  window.webContents.executeJavaScript = async () => health;
  window.isDestroyed = () => false;
  const failures = [],
    pending = [],
    actions = [];
  attachLoginHealth({
    window,
    source,
    onFailure: async (value) => failures.push(value),
    recover: async (value) => actions.push(value),
    schedule: (fn) => {
      pending.push(fn);
      return pending.length;
    },
    cancel: () => {},
    dialog: { showMessageBox: async () => ({ response: 0 }) },
  });
  return { window, failures, pending, actions };
}

test("login diagnostics discard account URLs, query tokens and arbitrary error text", () => {
  const failure = loginFailure(
    "login_load_failed",
    "https://accounts.google.com/signin?email=private&code=secret#token",
    "ERR_CONNECTION_RESET",
  );
  assert.equal(failure.host, "accounts.google.com");
  assert.equal(failure.networkCode, "ERR_CONNECTION_RESET");
  assert.doesNotMatch(JSON.stringify(failure), /private|secret|token|email/);
  assert.equal(loginFailure("login_load_failed", "bad", "private email").networkCode, "");
  assert.equal(sourceLoginUrl(source), "https://www.linkedin.com/login");
});

test("failed main-frame login reports network code and offers same-session direct sign-in", async () => {
  const f = fixture();
  f.window.webContents.emit(
    "did-fail-load",
    {},
    -105,
    "ERR_NAME_NOT_RESOLVED",
    "https://accounts.google.com/?code=private",
    true,
  );
  await tick();
  assert.equal(f.failures[0].networkCode, "ERR_NAME_NOT_RESOLVED");
  assert.deepEqual(f.actions, ["https://www.linkedin.com/login"]);
});

test("redirect cancellation and failed subresources do not report failed login", async () => {
  const f = fixture();
  f.window.webContents.emit(
    "did-fail-load",
    {},
    -3,
    "ERR_ABORTED",
    "https://www.linkedin.com/",
    true,
  );
  f.window.webContents.emit(
    "did-fail-load",
    {},
    -105,
    "ERR_NAME_NOT_RESOLVED",
    "https://example.com/",
    false,
  );
  await tick();
  assert.equal(f.failures.length, 0);
});

test("persistent blank page is reported only after two checks", async () => {
  const f = fixture({ blank: true });
  f.window.webContents.emit("did-finish-load");
  f.pending.shift()();
  await tick();
  assert.equal(f.failures.length, 0);
  f.pending.shift()();
  await tick();
  assert.equal(f.failures[0].code, "login_page_blank");
});

test("new navigation invalidates pending blank-page report", async () => {
  const f = fixture({ blank: true });
  f.window.webContents.emit("did-finish-load");
  f.pending.shift()();
  await tick();
  f.window.webContents.emit("did-start-navigation", {}, "https://www.linkedin.com/", false, true);
  f.pending.shift()();
  await tick();
  assert.equal(f.failures.length, 0);
});

test("provider rejection is distinct from network failure and blank page", async () => {
  const f = fixture({ unsupported: true });
  f.window.webContents.emit("did-finish-load");
  f.pending.shift()();
  await tick();
  assert.equal(f.failures[0].code, "embedded_login_unsupported");
});

import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { watchSourceLogin } from "../src/desktop/auto-connect.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  window.isDestroyed = () => false;
  const state = { authentication: "signed_out", busy: false, connected: 0, reads: 0 };
  const scheduled = new Map();
  let sequence = 0;
  const watcher = watchSourceLogin({
    window,
    inspect: async () => {
      state.reads += 1;
      return { ...state };
    },
    isBusy: () => state.busy,
    onSignedIn: async () => {
      state.connected += 1;
      window.webContents.emit("did-finish-load");
    },
    schedule: (fn) => {
      scheduled.set(++sequence, fn);
      return sequence;
    },
    cancel: (id) => scheduled.delete(id),
  });
  async function tick() {
    const entry = scheduled.entries().next().value;
    if (entry) {
      scheduled.delete(entry[0]);
      entry[1]();
      await flush();
    }
  }
  return { window, state, scheduled, tick, watcher };
}
test("login completion automatically connects once without a verification click", async () => {
  const f = fixture();
  await f.tick();
  assert.equal(f.state.connected, 0);
  f.state.authentication = "signed_in";
  f.window.webContents.emit("did-navigate-in-page");
  await f.tick();
  await f.tick();
  assert.equal(f.state.connected, 1);
});
test("security challenge is left for the user and never treated as success", async () => {
  const f = fixture();
  f.state.authentication = "challenge";
  await f.tick();
  assert.equal(f.state.connected, 0);
  assert.equal(f.scheduled.size, 1);
  f.state.authentication = "signed_in";
  await f.tick();
  assert.equal(f.state.connected, 1);
});
test("a slow same-page login is still detected after the initial fast polling window", async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) await f.tick();
  f.state.authentication = "signed_in";
  await f.tick();
  assert.equal(f.state.connected, 1);
});
test("automatic checks do not interfere with a running source operation", async () => {
  const f = fixture();
  f.state.busy = true;
  f.state.authentication = "signed_in";
  await f.tick();
  assert.equal(f.state.reads, 0);
  f.state.busy = false;
  await f.tick();
  assert.equal(f.state.connected, 1);
});
test("closing the source window cancels automatic connection", async () => {
  const f = fixture();
  f.state.authentication = "signed_in";
  f.window.emit("closed");
  await f.tick();
  assert.equal(f.state.connected, 0);
});

test("reconnecting can watch a new login after the previous connection completed", async () => {
  const f = fixture();
  f.state.authentication = "signed_in";
  await f.tick();
  assert.equal(f.state.connected, 1);
  f.watcher.restart();
  await f.tick();
  assert.equal(f.state.connected, 2);
});

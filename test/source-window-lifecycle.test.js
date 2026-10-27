import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { retainSourceWindow } from "../src/desktop/source-window-lifecycle.js";
test("closing an active read window warns instead of interrupting lazy-loading", () => {
  const window = new EventEmitter();
  let hidden = 0,
    warnings = 0,
    prevented = 0;
  window.hide = () => hidden++;
  retainSourceWindow(
    window,
    () => false,
    () => true,
    () => warnings++,
  );
  window.emit("close", { preventDefault: () => prevented++ });
  assert.equal(hidden, 0);
  assert.equal(warnings, 1);
  assert.equal(prevented, 1);
});
test("closing a login/search window hides it without destroying the session, until shutdown", () => {
  const window = new EventEmitter();
  let hidden = 0,
    prevented = 0,
    quitting = false;
  window.hide = () => hidden++;
  retainSourceWindow(window, () => quitting);
  window.emit("close", { preventDefault: () => prevented++ });
  assert.equal(hidden, 1);
  assert.equal(prevented, 1);
  quitting = true;
  window.emit("close", { preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
});

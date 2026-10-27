import test from "node:test";
import assert from "node:assert/strict";

import { disablePlatformPasskeyPrompt } from "../src/desktop/passkey-prompt.js";

test("embedded login windows drop the platform authenticator that blocks typing", () => {
  const switches = [];
  disablePlatformPasskeyPrompt({ appendSwitch: (name, value) => switches.push([name, value]) });
  assert.deepEqual(switches, [["disable-blink-features", "WebAuth"]]);
});

test("a command line without appendSwitch is rejected instead of silently ignored", () => {
  assert.throws(() => disablePlatformPasskeyPrompt({}), TypeError);
  assert.throws(() => disablePlatformPasskeyPrompt(), TypeError);
});

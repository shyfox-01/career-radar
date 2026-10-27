import test from "node:test";
import assert from "node:assert/strict";
import { waitForReadableSource } from "../public/login-resume.js";
test("opens the requested login once and resumes only after reading is verified", async () => {
  let tick = 0;
  const opened = [];
  const result = await waitForReadableSource({
    sourceIds: ["cn-shixiseng"],
    openSource: async (id) => opened.push(id),
    readConnections: async () => [
      {
        sourceId: "cn-shixiseng",
        authentication: tick < 2 ? "challenge" : "signed_in",
        extraction: tick < 2 ? "blocked" : "ready",
        lastFailure: tick < 2 ? { code: "challenge_required" } : null,
      },
    ],
    delay: async () => {
      tick++;
    },
    now: () => tick,
    timeoutMs: 5,
  });
  assert.equal(result, "cn-shixiseng");
  assert.deepEqual(opened, ["cn-shixiseng"]);
  assert.equal(tick, 2);
});
test("an unrelated ready source and an unverified login cannot resume the requested task", async () => {
  let tick = 0;
  const result = await waitForReadableSource({
    sourceIds: ["cn-maimai"],
    openSource: async () => {},
    readConnections: async () => [
      { sourceId: "sg-linkedin", authentication: "signed_in", extraction: "ready" },
      { sourceId: "cn-maimai", authentication: "signed_in", extraction: "unknown" },
    ],
    delay: async () => {
      tick++;
    },
    now: () => tick,
    timeoutMs: 3,
  });
  assert.equal(result, null);
  assert.equal(tick, 3);
});
test("cancelled waiting never opens a source window", async () => {
  let opened = false;
  const result = await waitForReadableSource({
    sourceIds: ["cn-maimai"],
    shouldStop: () => true,
    openSource: async () => {
      opened = true;
    },
    readConnections: async () => [],
  });
  assert.equal(result, null);
  assert.equal(opened, false);
});

test("pausing during the initial status read prevents opening a login window", async () => {
  let stopped = false,
    opened = false;
  const result = await waitForReadableSource({
    sourceIds: ["cn-maimai"],
    shouldStop: () => stopped,
    readConnections: async () => {
      stopped = true;
      return [];
    },
    openSource: async () => {
      opened = true;
    },
  });
  assert.equal(result, null);
  assert.equal(opened, false);
});

test("a stalled status request observes the login deadline", { timeout: 500 }, async () => {
  const keepAlive = setTimeout(() => {}, 700);
  try {
    const result = await waitForReadableSource({
      sourceIds: ["cn-maimai"],
      timeoutMs: 30,
      readConnections: () => new Promise(() => {}),
      openSource: async () => assert.fail("Must not open after timeout"),
    });
    assert.equal(result, null);
  } finally {
    clearTimeout(keepAlive);
  }
});

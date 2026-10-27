import test from "node:test";
import assert from "node:assert/strict";
import { runSearchBatches } from "../public/search-runner.js";
test("search continues queued pages, then stops when only user actions remain", async () => {
  let calls = 0;
  const r = await runSearchBatches({
    runBatch: async () => ({ searchContinuation: { automaticAvailable: ++calls < 3 } }),
  });
  assert.equal(r.batches, 3);
  assert.equal(r.limitReached, false);
});
test("pause and safety budget prevent endless automatic retries", async () => {
  let stop = false;
  const r = await runSearchBatches({
    runBatch: async () => ({ searchContinuation: { automaticAvailable: true } }),
    onBatch: () => {
      stop = true;
    },
    shouldStop: () => stop,
  });
  assert.equal(r.batches, 1);
  const limited = await runSearchBatches({
    maxBatches: 2,
    runBatch: async () => ({ searchContinuation: { automaticAvailable: true } }),
  });
  assert.equal(limited.limitReached, true);
  assert.equal(limited.batches, 2);
});
test("only follow-up batches are marked automatic so blocked sources can be skipped", async () => {
  const flags = [];
  await runSearchBatches({
    runBatch: async (options) => {
      flags.push(options?.automatic);
      return { searchContinuation: { automaticAvailable: flags.length < 2 } };
    },
  });
  assert.deepEqual(flags, [false, true]);
});

test("an authenticated user action resumes a blocked batch without another search click", async () => {
  const flags = [];
  let waited = 0;
  const resumed = [];
  const result = await runSearchBatches({
    runBatch: async ({ automatic, resumeSourceId }) => {
      flags.push(automatic);
      resumed.push(resumeSourceId ?? null);
      return {
        searchContinuation: {
          automaticAvailable: false,
          remainingCount: flags.length === 1 ? 1 : 0,
        },
      };
    },
    waitForAccess: async () => {
      waited++;
      return "cn-shixiseng";
    },
  });
  assert.deepEqual(flags, [false, true]);
  assert.deepEqual(resumed, [null, "cn-shixiseng"]);
  assert.equal(waited, 1);
  assert.equal(result.batches, 2);
});

test("user cancellation or an unsuccessful login wait never retries a blocked source", async () => {
  let stopped = false,
    calls = 0;
  await runSearchBatches({
    runBatch: async () => {
      calls++;
      return { searchContinuation: { automaticAvailable: false, remainingCount: 1 } };
    },
    waitForAccess: async () => {
      stopped = true;
      return true;
    },
    shouldStop: () => stopped,
  });
  assert.equal(calls, 1);
  const result = await runSearchBatches({
    runBatch: async () => ({
      searchContinuation: { automaticAvailable: false, remainingCount: 1 },
    }),
    waitForAccess: async () => false,
  });
  assert.equal(result.batches, 1);
});

import test from "node:test";
import assert from "node:assert/strict";

// Catches the old acceptance mistake: finished queue / login / zero jobs was
// presented without distinguishing it from successful job extraction.
test("acceptance separates readable data from an intentionally bounded scan", async () => {
  const module = await import("../scripts/acceptance-result.mjs").catch(() => ({}));
  assert.equal(
    typeof module.summarizeAcceptance,
    "function",
    "a shared evidence classifier is required",
  );
  const result = module.summarizeAcceptance({
    jobs: [{ title: "Analyst", company: "Example", url: "https://example.test/job/1" }],
    scans: [
      {
        pagesRead: 1,
        complete: false,
        stopReason: "page_limit",
        nextUrl: "https://example.test/page/2",
      },
    ],
    failedTasks: [],
    pendingTasks: [{ code: "page_limit" }],
    unsupportedTaskIds: [],
  });
  assert.equal(result.reading, "passed");
  assert.equal(result.pagination, "not_tested");
  assert.equal(result.fullInventory, false);
});

test("login failure, empty result and invalid row never count as reading passed", async () => {
  const module = await import("../scripts/acceptance-result.mjs").catch(() => ({}));
  assert.equal(typeof module.summarizeAcceptance, "function");
  for (const [result, expected] of [
    [{ jobs: [], failedTasks: [{ code: "sign_in_required" }] }, "needs_login"],
    [{ jobs: [], failedTasks: [{ code: "challenge_required" }] }, "needs_verification"],
    [{ jobs: [], scans: [{ complete: true, stopReason: "last_page" }] }, "empty_sample"],
    [{ jobs: [{ title: "Analyst", url: "javascript:evil()" }] }, "invalid_data"],
    [{ jobs: [], unsupportedTaskIds: ["test"] }, "unsupported"],
  ])
    assert.equal(module.summarizeAcceptance(result).reading, expected);
});

test("two distinct successful pages prove continuation, not universal completeness", async () => {
  const module = await import("../scripts/acceptance-result.mjs").catch(() => ({}));
  assert.equal(typeof module.summarizeAcceptance, "function");
  const result = module.summarizeAcceptance({
    jobs: [{ title: "Analyst", url: "https://example.test/1" }],
    scans: [{ pagesRead: 2, complete: false, stopReason: "page_limit" }],
  });
  assert.equal(result.pagination, "passed");
  assert.equal(result.fullInventory, false);
});

test("a failed acceptance waits for a user decision instead of silently advancing", async () => {
  const module = await import("../scripts/acceptance-result.mjs");
  assert.equal(typeof module.acceptanceNextAction, "function");
  assert.equal(module.acceptanceNextAction({ reading: "needs_login" }), "wait");
  assert.equal(module.acceptanceNextAction({ reading: "failed" }), "wait");
  assert.equal(module.acceptanceNextAction({ reading: "failed" }, "retry"), "retry");
  assert.equal(module.acceptanceNextAction({ reading: "failed" }, "skip"), "skip");
  assert.equal(
    module.acceptanceNextAction({ reading: "passed", reasons: ["sign_in_required"] }),
    "wait",
  );
  assert.equal(module.acceptanceNextAction({ reading: "passed", reasons: ["page_limit"] }), "next");
});

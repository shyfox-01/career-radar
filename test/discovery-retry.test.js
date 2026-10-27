import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createCareerRadarServer } from "../src/server.js";
const provider = {
  id: "codex",
  name: "Test provider",
  detect: async () => ({ installed: true, authenticated: true }),
  status: async () => ({ state: "ready" }),
  capabilities: async () => ({ discovery: true }),
  discover: async () => ({
    jobs: [{ title: "Analyst", company: "Synthetic", url: "https://example.com/job/1" }],
  }),
};
async function fixture(options, run) {
  const root = await mkdtemp(path.resolve(".career-radar-data", "retry-"));
  const server = createCareerRadarServer({
    dataRoot: root,
    localModelProvider: provider,
    ...options,
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (suffix, method = "GET", body) => {
    const r = await fetch(`${origin}/api/workspaces/test${suffix}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(r.status, 200);
    return r.json();
  };
  try {
    await run(api);
  } finally {
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  }
}
test("automatic follow-up runs untouched sources without retrying known login failures", async () => {
  const attempted = [];
  await fixture(
    {
      sourceSessionController: {
        discover: async (tasks) => {
          attempted.push(tasks.map((t) => t.id));
          return {
            jobs: [],
            completedTaskIds: tasks.filter((t) => t.sourceId === "sg-jobstreet").map((t) => t.id),
            failedTasks: tasks
              .filter((t) => t.sourceId === "sg-linkedin")
              .map((t) => ({ taskId: t.id, sourceId: t.sourceId, code: "sign_in_required" })),
            unsupportedTaskIds: [],
            pendingTasks: [],
          };
        },
      },
    },
    async (api) => {
      const searchPlan = Array.from({ length: 41 }, (_, i) => ({
        id: `task${i}`,
        sourceId: i < 40 ? "sg-linkedin" : "sg-jobstreet",
      }));
      await api("", "PUT", {
        jobs: [],
        resume: { redactedPreview: "Synthetic candidate" },
        searchPlan,
        searchQueue: {
          executeIds: searchPlan.slice(0, 40).map((t) => t.id),
          queuedIds: ["task40"],
        },
      });
      const first = await api("/discover", "POST");
      assert.equal(first.searchContinuation.automaticAvailable, true);
      const second = await api("/discover?automatic=1", "POST");
      assert.deepEqual(attempted[1], ["task40"]);
      assert.equal(second.searchContinuation.automaticAvailable, false);
      assert.equal(second.searchQueue.total, 40);
      assert.equal(second.lastDiscoveryAt ?? null, null);
      assert.equal(second.sourceCheckpoints.task0.stopReason, "sign_in_required");
      await api("/discover", "POST");
      assert.equal(attempted[2].length, 40);
    },
  );
});
test("a failed new refresh cannot export last run as currently complete", async () => {
  let calls = 0;
  await fixture(
    {
      sourceSessionController: {
        discover: async (tasks, options) => {
          if (++calls > 1) throw Error("Browser load failed");
          const scan = {
            pagesRead: 1,
            uniqueJobs: 0,
            complete: true,
            nextUrl: null,
            stopReason: "last_page",
          };
          await options.onProgress(tasks[0], { jobs: [], scan });
          return {
            jobs: [],
            completedTaskIds: ["one"],
            failedTasks: [],
            unsupportedTaskIds: [],
            pendingTasks: [],
            scans: [{ taskId: "one", ...scan }],
          };
        },
      },
    },
    async (api) => {
      await api("", "PUT", {
        jobs: [],
        resume: { redactedPreview: "Synthetic candidate" },
        searchPlan: [
          {
            id: "one",
            sourceId: "sg-linkedin",
            searchUrl: "https://www.linkedin.com/jobs/search/",
          },
        ],
        searchQueue: { executeIds: ["one"], queuedIds: [] },
      });
      assert.equal((await api("/discover", "POST")).sourceCheckpoints.one.complete, true);
      const next = await api("/discover", "POST");
      assert.equal(next.sourceCheckpoints.one.complete, false);
      assert.equal(next.sourceCheckpoints.one.stopReason, "source_run_failed");
      assert.equal(next.sourceCheckpoints.one.previousCoverage.complete, true);
    },
  );
});
test("browser-only mode can use a provider without claiming a native adapter succeeded", async () => {
  await fixture({}, async (api) => {
    await api("", "PUT", {
      jobs: [],
      resume: { redactedPreview: "Synthetic candidate" },
      searchPlan: [{ id: "one", sourceId: "sg-linkedin" }],
      searchQueue: { executeIds: ["one"], queuedIds: [] },
    });
    const result = await api("/discover", "POST");
    assert.equal(result.jobs.length, 1);
    assert.deepEqual(result.lastSourceAdapterRun.completedTaskIds, []);
    assert.deepEqual(result.lastSourceAdapterRun.unsupportedTaskIds, ["one"]);
    assert.equal(result.jobs[0].verification, "ai_unverified");
  });
});

test("verifying one login releases only that source and preserves other failure exclusions", async () => {
  const attempted = [];
  let ready = false;
  await fixture(
    {
      sourceSessionController: {
        list: async () => [
          {
            sourceId: "sg-linkedin",
            authentication: ready ? "signed_in" : "signed_out",
            extraction: ready ? "ready" : "blocked",
          },
        ],
        discover: async (tasks) => {
          attempted.push(tasks.map((t) => t.id));
          return {
            jobs: [],
            completedTaskIds: ready ? tasks.map((t) => t.id) : [],
            unsupportedTaskIds: [],
            pendingTasks: [],
            failedTasks: ready
              ? []
              : tasks.map((t) => ({
                  taskId: t.id,
                  sourceId: t.sourceId,
                  code: t.id === "one" ? "sign_in_required" : "pagination_unavailable",
                })),
          };
        },
      },
    },
    async (api) => {
      await api("", "PUT", {
        jobs: [],
        resume: { redactedPreview: "Synthetic" },
        searchPlan: [
          { id: "one", sourceId: "sg-linkedin" },
          { id: "two", sourceId: "sg-jobstreet" },
        ],
        searchQueue: { executeIds: ["one", "two"], queuedIds: [] },
      });
      await api("/discover", "POST");
      await api("/discover?automatic=1&resumeSource=sg-linkedin", "POST");
      assert.equal(attempted.length, 1);
      ready = true;
      const result = await api("/discover?automatic=1&resumeSource=sg-linkedin", "POST");
      assert.deepEqual(attempted[1], ["one"]);
      assert.deepEqual(result.searchContinuation.blockedSourceIds, ["sg-jobstreet"]);
    },
  );
});

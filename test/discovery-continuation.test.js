import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { createCareerRadarServer } from "../src/server.js";

test("partial adapter search persists each page, never falls back to AI, and resumes without resetting totals or statuses", async () => {
  const root = await mkdtemp(path.resolve(".career-radar-data", "continuation-"));
  let calls = 0,
    providerCalls = 0,
    origin;
  const provider = {
    id: "codex",
    name: "Fake",
    detect: async () => ({ installed: true, authenticated: true }),
    status: async () => ({ state: "ready" }),
    capabilities: async () => ({ discovery: true }),
    discover: async () => {
      providerCalls++;
      return { jobs: [] };
    },
  };
  const controller = {
    list: async () => [],
    discover: async (tasks, options) => {
      calls++;
      const task = tasks[0];
      assert.equal(
        task.resumeUrl,
        calls === 1 ? undefined : "https://www.linkedin.com/jobs/search/?start=25",
      );
      const jobs = [
        {
          title: "Analyst Intern",
          company: "Example",
          url: "https://www.linkedin.com/jobs/view/123",
          sourceTaskId: task.id,
        },
      ];
      if (calls === 2)
        jobs.push({
          title: "Data Intern",
          company: "Example",
          url: "https://www.linkedin.com/jobs/view/456",
          sourceTaskId: task.id,
        });
      const scan = {
        pagesRead: 1,
        uniqueJobs: jobs.length,
        complete: calls === 2,
        nextUrl: calls === 1 ? "https://www.linkedin.com/jobs/search/?start=25" : null,
        stopReason: calls === 1 ? "page_limit" : "last_page",
      };
      await options.onProgress(task, { jobs, scan });
      const saved = await (await fetch(`${origin}/api/workspaces/test`)).json();
      assert.equal(saved.jobs.length, jobs.length);
      if (calls === 1) {
        await fetch(`${origin}/api/workspaces/test/jobs/${saved.jobs[0].id}/status`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: "applied" }),
        });
      }
      return {
        jobs,
        scans: [{ taskId: task.id, ...scan }],
        completedTaskIds: calls === 2 ? [task.id] : [],
        failedTasks: [],
        unsupportedTaskIds: [],
        pendingTasks:
          calls === 1 ? [{ taskId: task.id, code: "page_limit", nextUrl: scan.nextUrl }] : [],
      };
    },
  };
  const server = createCareerRadarServer({
    dataRoot: root,
    localModelProvider: provider,
    sourceSessionController: controller,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await fetch(`${origin}/api/workspaces/test/resume`, {
      method: "POST",
      headers: { "x-filename": "resume.txt" },
      body: "Synthetic Python SQL candidate",
    });
    await fetch(`${origin}/api/workspaces/test/search-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        markets: ["SG"],
        roleTitles: ["Data Analyst"],
        employmentTypes: ["internship"],
        selectedSourceIds: ["sg-linkedin"],
      }),
    });
    const one = await (
      await fetch(`${origin}/api/workspaces/test/discover`, { method: "POST" })
    ).json();
    assert.equal(providerCalls, 0);
    assert.equal(one.jobs[0].status, "applied");
    assert.equal(one.lastDiscoveryAt ?? null, null);
    const two = await (
      await fetch(`${origin}/api/workspaces/test/discover`, { method: "POST" })
    ).json();
    assert.equal(providerCalls, 0);
    assert.equal(two.jobs.length, 2);
    assert.equal(two.jobs[0].status, "applied");
    assert.equal(Object.values(two.sourceCheckpoints)[0].pagesRead, 2);
    assert.equal(Object.values(two.sourceCheckpoints)[0].uniqueJobs, 2);
    assert.ok(two.lastDiscoveryAt);
    assert.equal(two.searchQueue.total, 0);
    const excel = await fetch(`${origin}/api/workspaces/test/export.xlsx`);
    assert.equal(excel.status, 200);
    assert.match(excel.headers.get("content-type"), /spreadsheetml/);
    assert.ok((await excel.arrayBuffer()).byteLength > 1000);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

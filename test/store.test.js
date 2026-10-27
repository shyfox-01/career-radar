import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { WorkspaceStore } from "../src/store/workspace-store.js";

const root = path.resolve(".career-radar-data", "tests", "store");

test.beforeEach(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
});

test.after(async () => {
  await rm(root, {
    recursive: true,
    force: true,
  });
});

test("WorkspaceStore persists a job status across instances", async () => {
  const first = new WorkspaceStore({ root });
  await first.saveWorkspace("demo", {
    profile: { markets: ["SG"] },
    jobs: [{ id: "job-1", status: "new" }],
  });
  await first.updateJobStatus("demo", "job-1", "applied");

  const second = new WorkspaceStore({ root });
  const workspace = await second.loadWorkspace("demo");

  assert.equal(workspace.jobs[0].status, "applied");
});

test("WorkspaceStore prevents a workspace id from escaping its data root", async () => {
  const store = new WorkspaceStore({ root });

  await assert.rejects(
    () => store.saveWorkspace("../private", { jobs: [] }),
    /Invalid workspace id/,
  );
});

test("WorkspaceStore rejects an unknown job status", async () => {
  const store = new WorkspaceStore({ root });
  await store.saveWorkspace("demo", {
    jobs: [{ id: "job-1", status: "new" }],
  });

  await assert.rejects(
    () => store.updateJobStatus("demo", "job-1", "teleported"),
    /Invalid job status/,
  );
});

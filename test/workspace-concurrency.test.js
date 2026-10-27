import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { WorkspaceStore } from "../src/store/workspace-store.js";
import { mergeScanProgress } from "../src/sources/checkpoint.js";

test("page transaction and overlapping status edit preserve both changes", async () => {
  const root = await mkdtemp(path.resolve(".career-radar-data", "concurrency-"));
  const store = new WorkspaceStore({ root });
  try {
    await store.saveWorkspace("test", { jobs: [{ id: "one", status: "new" }] });
    let release, entered;
    const gate = new Promise((r) => {
      release = r;
    });
    const ready = new Promise((r) => {
      entered = r;
    });
    const page = store.updateWorkspace("test", async (workspace) => {
      entered();
      await gate;
      workspace.jobs.push({ id: "two", status: "new" });
      return workspace;
    });
    await ready;
    const edit = store.updateJobStatus("test", "one", "applied");
    release();
    await Promise.all([page, edit]);
    const saved = await store.loadWorkspace("test");
    assert.equal(saved.jobs.length, 2);
    assert.equal(saved.jobs[0].status, "applied");
    await assert.rejects(
      store.updateWorkspace("test", () => {
        throw Error("test failure");
      }),
    );
    await store.updateJobStatus("test", "two", "saved");
    assert.equal((await store.loadWorkspace("test")).jobs[1].status, "saved");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("zero-page retry retains an incomplete checkpoint until a page is replaced", () => {
  const prior = {
    pagesRead: 3,
    lastPageIncomplete: true,
    complete: false,
    nextUrl: "https://example.com/page3",
  };
  const paused = mergeScanProgress(prior, {
    pagesRead: 0,
    complete: false,
    stopReason: "cancelled",
    nextUrl: prior.nextUrl,
  });
  assert.equal(paused.pagesRead, 3);
  assert.equal(paused.lastPageIncomplete, true);
  const resumed = mergeScanProgress(paused, {
    pagesRead: 2,
    complete: true,
    lastPageIncomplete: false,
  });
  assert.equal(resumed.pagesRead, 4);
  assert.equal(resumed.lastPageIncomplete, false);
});

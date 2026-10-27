import test from "node:test";
import assert from "node:assert/strict";

import { buildSourceQueue } from "../src/sources/queue.js";

test("source queue is deterministic, executes at most forty, and retains overflow", () => {
  const tasks = Array.from({ length: 57 }, (_, index) => ({
    id: `task-${String(index).padStart(2, "0")}`,
    access: index % 3 === 0 ? "direct" : "login",
    official: index === 56,
    sourcePriority: index % 5,
    roleScore: index,
    freshnessRank: index % 7,
  }));
  const first = buildSourceQueue(tasks);
  const second = buildSourceQueue([...tasks].reverse());

  assert.deepEqual(first, second);
  assert.equal(first.executeIds.length, 40);
  assert.equal(first.queuedIds.length, 17);
  assert.equal(first.total, 57);
  assert.equal(new Set([...first.executeIds, ...first.queuedIds]).size, 57);
  assert.equal(first.executeIds[0], "task-56");
});

test("completed identities are absent and limit remains bounded", () => {
  const tasks = Array.from({ length: 45 }, (_, index) => ({ id: `t-${index}`, access: "direct" }));
  const queue = buildSourceQueue(tasks, { completedTaskIds: ["t-0", "t-1"], limit: 10 });
  assert.equal(queue.executeIds.length, 10);
  assert.equal(queue.queuedIds.length, 33);
  assert.equal(queue.executeIds.includes("t-0"), false);
  assert.equal(queue.queuedIds.includes("t-1"), false);
});

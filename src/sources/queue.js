function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function compareTasks(left, right) {
  const dimensions = [
    [Boolean(left.official), Boolean(right.official)],
    [left.access === "direct", right.access === "direct"],
    [number(left.sourcePriority), number(right.sourcePriority)],
    [number(left.roleScore), number(right.roleScore)],
    [number(left.freshnessRank), number(right.freshnessRank)],
  ];
  for (const [leftValue, rightValue] of dimensions) {
    if (leftValue !== rightValue) return Number(rightValue) - Number(leftValue);
  }
  return left.id.localeCompare(right.id, "en");
}

export function buildSourceQueue(tasks, { limit = 40, completedTaskIds = [] } = {}) {
  if (!Array.isArray(tasks)) throw new TypeError("Search tasks must be an array");
  if (!Number.isInteger(limit) || limit < 1 || limit > 40)
    throw new RangeError("Queue limit must be between 1 and 40");
  const completed = new Set(completedTaskIds);
  const ids = new Set();
  const remaining = tasks
    .filter((task) => {
      if (!task || typeof task.id !== "string" || !task.id)
        throw new TypeError("Every search task needs an id");
      if (ids.has(task.id)) throw new TypeError(`Duplicate search task id: ${task.id}`);
      ids.add(task.id);
      return !completed.has(task.id);
    })
    .sort(compareTasks);
  return {
    executeIds: remaining.slice(0, limit).map((task) => task.id),
    queuedIds: remaining.slice(limit).map((task) => task.id),
    total: remaining.length,
    limit,
  };
}

// Continue useful work, but do not repeatedly retry login challenges or broken pages.
export async function runSearchBatches({
  runBatch,
  shouldStop = () => false,
  onBatch = () => {},
  waitForAccess = async () => false,
  maxBatches = 10,
}) {
  if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 20)
    throw new RangeError("Invalid batch limit");
  let workspace,
    batches = 0,
    resumeSourceId;
  while (!shouldStop() && batches < maxBatches) {
    workspace = await runBatch({ automatic: batches > 0, resumeSourceId });
    resumeSourceId = undefined;
    batches++;
    await onBatch(workspace, batches);
    if (!workspace.searchContinuation?.automaticAvailable) {
      if (shouldStop() || batches >= maxBatches || !workspace.searchContinuation?.remainingCount)
        break;
      resumeSourceId = await waitForAccess(workspace);
      if (typeof resumeSourceId !== "string" || !resumeSourceId) break;
    }
  }
  return {
    workspace,
    batches,
    limitReached:
      batches === maxBatches && Boolean(workspace?.searchContinuation?.automaticAvailable),
  };
}

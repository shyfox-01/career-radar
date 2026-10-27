// Poll local capability metadata, not the website or AI provider.
export async function waitForReadableSource({
  sourceIds,
  readConnections,
  openSource,
  shouldStop = () => false,
  onWaiting = () => {},
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => Date.now(),
  timeoutMs = 120000,
}) {
  if (shouldStop() || !sourceIds.length) return null;
  const ids = new Set(sourceIds),
    deadline = now() + timeoutMs;
  const stopped = Symbol("stopped");
  const guarded = (operation) =>
    new Promise((resolve, reject) => {
      if (shouldStop() || now() >= deadline) {
        resolve(stopped);
        return;
      }
      const abort = new AbortController();
      let settled = false,
        timer,
        poll;
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        if (error) reject(error);
        else resolve(value);
      };
      const stop = () => {
        abort.abort();
        finish(stopped);
      };
      timer = setTimeout(stop, Math.max(1, deadline - now()));
      poll = setInterval(() => {
        if (shouldStop()) stop();
      }, 50);
      Promise.resolve()
        .then(() => operation(abort.signal))
        .then(
          (value) => finish(shouldStop() || now() >= deadline ? stopped : value),
          (error) => {
            if (shouldStop() || now() >= deadline) finish(stopped);
            else finish(null, error);
          },
        );
    });
  const ready = (connections) =>
    connections.find(
      (c) =>
        ids.has(c.sourceId) &&
        c.extraction === "ready" &&
        ["signed_in", "not_required"].includes(c.authentication) &&
        !c.lastFailure,
    )?.sourceId;
  const initialStatus = await guarded(readConnections);
  if (initialStatus === stopped || shouldStop()) return null;
  const initial = ready(initialStatus);
  if (initial) return initial;
  const target = sourceIds[0];
  onWaiting(target);
  if ((await guarded((signal) => openSource(target, signal))) === stopped || shouldStop())
    return null;
  while (!shouldStop() && now() < deadline) {
    const status = await guarded(readConnections);
    if (status === stopped) return null;
    const sourceId = ready(status);
    if (sourceId) return sourceId;
    await delay(1000);
  }
  return null;
}

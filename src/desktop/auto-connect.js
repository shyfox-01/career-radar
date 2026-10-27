// Watch login completion without navigating away from an unfinished login form.
export function watchSourceLogin({
  window,
  inspect,
  onSignedIn,
  isBusy = () => false,
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = clearTimeout,
}) {
  let timer;
  let stopped = false;
  let running = false;
  let attempts = 0;
  let generation = 0;
  function queue(delay = 700) {
    if (timer) cancel(timer);
    if (!stopped) {
      timer = schedule(() => {
        void check();
      }, delay);
      timer?.unref?.();
    }
  }
  async function check() {
    if (stopped || window.isDestroyed()) return;
    if (window.isVisible?.() === false) {
      queue(5000);
      return;
    }
    if (running || isBusy()) {
      queue();
      return;
    }
    running = true;
    const current = generation;
    try {
      const capability = await inspect();
      if (stopped || window.isDestroyed() || current !== generation) return;
      if (
        capability.authentication === "signed_in" ||
        (capability.authentication === "not_required" && capability.extraction === "ready")
      ) {
        // Complete once, so our verification navigation cannot trigger a loop.
        stopped = true;
        await onSignedIn(capability);
        return;
      }
      attempts++;
      queue(attempts < 12 && capability.authentication !== "challenge" ? 700 : 3000);
    } catch {
      // A navigation may destroy the JS execution context; retry on the next page.
      if (!stopped) {
        attempts++;
        queue(attempts < 12 ? 700 : 3000);
      }
    } finally {
      running = false;
    }
  }
  function pageChanged() {
    if (!stopped) {
      generation += 1;
      attempts = 0;
      queue();
    }
  }
  function stop() {
    stopped = true;
    generation += 1;
    if (timer) cancel(timer);
  }
  function restart() {
    if (window.isDestroyed()) return;
    stopped = false;
    generation += 1;
    attempts = 0;
    queue();
  }
  window.webContents.on("did-finish-load", pageChanged);
  window.webContents.on("did-navigate-in-page", pageChanged);
  window.on("closed", stop);
  queue();
  return { stop, restart };
}

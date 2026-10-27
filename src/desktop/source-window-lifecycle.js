export function retainSourceWindow(window, isQuitting, isBusy = () => false, notify = () => {}) {
  window.on("close", (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    if (isBusy()) {
      notify();
      return;
    }
    window.hide?.();
  });
}

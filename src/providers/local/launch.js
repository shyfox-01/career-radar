import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// The Ollama the user installed, started the way they would start it themselves: the
// Windows tray app or the macOS app, else `ollama serve` from the PATH. Nothing is
// downloaded or installed.
export function findOllamaLauncher({
  env = process.env,
  platform = process.platform,
  exists = existsSync,
} = {}) {
  if (platform === "win32" && env.LOCALAPPDATA) {
    const folder = path.join(env.LOCALAPPDATA, "Programs", "Ollama");
    if (exists(path.join(folder, "ollama app.exe")))
      return { command: path.join(folder, "ollama app.exe"), args: [] };
    if (exists(path.join(folder, "ollama.exe")))
      return { command: path.join(folder, "ollama.exe"), args: ["serve"] };
  }
  if (platform === "darwin" && exists("/Applications/Ollama.app"))
    return { command: "open", args: ["-a", "Ollama"] };
  return { command: "ollama", args: ["serve"] };
}

// Detached, without a shell and with fixed arguments, so Ollama keeps running for the
// user's other tools after Career Radar closes.
export function launchOllama(launcher = findOllamaLauncher(), { spawnImpl = spawn } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(launcher.command, launcher.args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
    } catch {
      resolve(false);
      return;
    }
    child.once("error", () => resolve(false));
    child.once("spawn", () => {
      child.unref?.();
      resolve(true);
    });
  });
}

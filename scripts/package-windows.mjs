// electron-builder extracts its downloaded tools by renaming a temp file into its cache.
// When that cache sits on a different volume from the temp file, Windows refuses the
// rename with EXDEV and the build dies after packing the app but before writing an
// installer. Keeping the cache beside the project puts both on one volume, whichever
// drive the project happens to live on.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cache = path.join(projectRoot, ".build-cache", "electron-builder");
mkdirSync(cache, { recursive: true });

const builder = path.join(
  projectRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "electron-builder.cmd" : "electron-builder",
);

const result = spawnSync(builder, process.argv.slice(2), {
  stdio: "inherit",
  env: { ...process.env, ELECTRON_BUILDER_CACHE: cache },
  shell: process.platform === "win32",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);

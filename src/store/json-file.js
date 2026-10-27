import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// A small JSON document on disk, replaced atomically so a crash mid-write never leaves
// half a file behind.
export function createJsonFileRepository(filename) {
  const resolved = path.resolve(filename);
  return {
    async load() {
      try {
        return JSON.parse(await readFile(resolved, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") return {};
        throw error;
      }
    },
    async save(value) {
      await mkdir(path.dirname(resolved), { recursive: true });
      const temporary = path.join(
        path.dirname(resolved),
        `.${path.basename(resolved)}.${randomUUID()}.tmp`,
      );
      await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(temporary, resolved);
    },
  };
}

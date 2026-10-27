import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const WORKSPACE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const JOB_STATUSES = new Set([
  "new",
  "viewed",
  "saved",
  "applied",
  "interview",
  "offer",
  "rejected",
]);

function validateWorkspaceId(id) {
  if (typeof id !== "string" || !WORKSPACE_ID.test(id)) {
    throw new TypeError("Invalid workspace id");
  }
}

export class WorkspaceStore {
  constructor({ root }) {
    if (!root) throw new TypeError("A data root is required");
    this.root = path.resolve(root);
    this.mutations = new Map();
  }

  // Covers the entire read-modify-write operation, not just the final rename.
  async runExclusive(id, operation) {
    validateWorkspaceId(id);
    const previous = this.mutations.get(id) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(operation);
    this.mutations.set(id, pending);
    try {
      return await pending;
    } finally {
      if (this.mutations.get(id) === pending) this.mutations.delete(id);
    }
  }

  async updateWorkspace(id, mutate) {
    return this.runExclusive(id, async () => {
      const workspace = await this.loadWorkspace(id);
      return this.saveWorkspace(id, await mutate(workspace));
    });
  }

  workspacePath(id) {
    validateWorkspaceId(id);
    return path.join(this.root, `${id}.json`);
  }

  async loadWorkspace(id) {
    const filename = this.workspacePath(id);
    try {
      return JSON.parse(await readFile(filename, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { id, profile: {}, searchPlan: [], jobs: [], updatedAt: null };
      }
      throw error;
    }
  }

  async saveWorkspace(id, workspace) {
    const filename = this.workspacePath(id);
    await mkdir(this.root, { recursive: true });
    const payload = {
      ...workspace,
      id,
      jobs: Array.isArray(workspace.jobs) ? workspace.jobs : [],
      updatedAt: new Date().toISOString(),
    };
    const temporary = path.join(this.root, `.${id}.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, filename);
    return payload;
  }

  async updateJobStatus(workspaceId, jobId, status) {
    if (!JOB_STATUSES.has(status)) throw new TypeError("Invalid job status");
    return this.updateWorkspace(workspaceId, async (workspace) => {
      const index = workspace.jobs.findIndex((job) => job.id === jobId);
      if (index < 0) throw new RangeError("Job not found");

      workspace.jobs[index] = {
        ...workspace.jobs[index],
        status,
        statusUpdatedAt: new Date().toISOString(),
      };
      return workspace;
    });
  }
}

export const ALLOWED_JOB_STATUSES = Object.freeze([...JOB_STATUSES]);

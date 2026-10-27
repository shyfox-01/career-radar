import { LocalModelError, createOllamaClient, pickToolModel } from "./local/ollama.js";
import { createMyCareersFutureSearch } from "./local/mycareersfuture.js";
import { runLocalTask } from "./local/agent.js";
import { deriveProviderState } from "./provider.js";

const NAME = "Ollama (local model)";
// Losing the model server ends the run; a single task's bad answer does not.
const FATAL = new Set(["local_model_unreachable", "local_model_timeout"]);

// A local model has no web access of its own. Each source it can search is a tool the
// program runs for it; tasks for any other source are reported as unsupported.
export function createOllamaProvider({
  client,
  searchTools = [createMyCareersFutureSearch()],
  model,
  maxSteps = 8,
  // Starts the installed Ollama when its server is not answering; absent, nothing is started.
  startServer = null,
  startWaitMs = 30_000,
  retryStartAfterMs = 60_000,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  clock = () => Date.now(),
} = {}) {
  const tools = new Map(searchTools.map((tool) => [tool.sourceId, tool]));
  const capabilities = Object.freeze({
    discovery: true,
    webSearch: false,
    structuredOutput: true,
    localModel: true,
    sourceIds: Object.freeze([...tools.keys()]),
  });
  let ollama = client;
  let starting = null;
  let lastStartAt = -Infinity;
  let startFailed = false;

  // Only Ollama's own default address is started here; another address may be a different
  // server the user runs on purpose. A failed start is not retried for a minute, so a
  // machine without Ollama is not asked again on every status check.
  async function ensureRunning() {
    if (typeof startServer !== "function") return false;
    try {
      ollama ??= createOllamaClient();
    } catch {
      return false;
    }
    if (ollama.baseUrl && new URL(ollama.baseUrl).port !== "11434") return false;
    if (starting) return starting;
    if (clock() - lastStartAt < retryStartAfterMs) return false;
    lastStartAt = clock();
    starting = (async () => {
      if (!(await startServer())) return false;
      for (let waited = 0; waited < startWaitMs; waited += 1000) {
        try {
          await ollama.listModels();
          return true;
        } catch {
          await pause(1000);
        }
      }
      return false;
    })()
      .then((started) => {
        startFailed = !started;
        return started;
      })
      .finally(() => {
        starting = null;
      });
    return starting;
  }

  async function probe() {
    try {
      // Created on first use, so a bad CAREER_RADAR_OLLAMA_URL shows up here instead of
      // stopping the server from starting.
      ollama ??= createOllamaClient();
      const picked = pickToolModel(await ollama.listModels(), model);
      return { installed: true, model: picked.model, reason: picked.reason };
    } catch (error) {
      return { installed: false, model: null, reason: error.message };
    }
  }

  return {
    id: "ollama",
    name: NAME,
    async detect() {
      return { installed: (await probe()).installed };
    },
    async status() {
      const result = await probe();
      return {
        id: "ollama",
        name: NAME,
        ...deriveProviderState({
          installed: result.installed,
          authenticated: result.installed,
          compatible: Boolean(result.model),
          capabilities,
        }),
        model: result.model,
        mode: "local",
        capabilities,
        detail:
          !result.installed && startFailed
            ? "Ollama could not be started; install it or open it yourself / 无法自动启动 Ollama，请确认已安装后手动打开"
            : result.reason,
      };
    },
    capabilities() {
      return capabilities;
    },
    ensureRunning,
    // Loading a model can take minutes from a cold disk. Starting it while the user is still
    // reviewing the resume and plan moves that wait out of the search.
    async prepare() {
      const { model: picked } = await probe();
      if (picked && typeof ollama.warm === "function") await ollama.warm({ model: picked });
    },
    async discover(input, options = {}) {
      let { model: picked, reason } = await probe();
      if (!picked && (await ensureRunning())) ({ model: picked, reason } = await probe());
      if (!picked)
        throw new LocalModelError(
          "local_model_unavailable",
          reason ?? "No local model is available / 没有可用的本地模型",
        );
      const shouldStop = options.shouldStop ?? (() => false);
      const jobs = [];
      const completedTaskIds = [];
      const unsupportedTaskIds = [];
      const failedTasks = [];
      const scans = [];
      let fatal = null;
      for (const task of input.plan ?? []) {
        const search = tools.get(task.sourceId);
        if (!search) {
          unsupportedTaskIds.push(task.id);
          continue;
        }
        if (fatal) {
          failedTasks.push({
            taskId: task.id,
            sourceId: task.sourceId,
            code: fatal.code,
            message: fatal.message,
          });
          continue;
        }
        if (shouldStop()) break;
        try {
          const result = await runLocalTask({
            client: ollama,
            model: picked,
            task,
            redactedResume: input.redactedResume,
            search,
            shouldStop,
            maxSteps,
          });
          jobs.push(...result.jobs);
          scans.push({ taskId: task.id, sourceId: task.sourceId, pagesRead: result.searches });
          if (result.stopReason !== "cancelled") completedTaskIds.push(task.id);
          // Each finished task is reported at once, so its jobs survive a later failure or pause.
          await options.onTaskDone?.(task, { jobs: result.jobs, pagesRead: result.searches });
        } catch (error) {
          const failure = {
            taskId: task.id,
            sourceId: task.sourceId,
            code: error?.code ?? "local_model_failed",
            message: error?.message ?? "Local model search failed / 本地模型搜索失败",
          };
          failedTasks.push(failure);
          if (FATAL.has(failure.code)) fatal = failure;
        }
      }
      return { jobs, completedTaskIds, unsupportedTaskIds, failedTasks, scans };
    },
  };
}

import { deduplicateJobs } from "./domain/jobs.js";
import { mergeScanProgress } from "./sources/checkpoint.js";
import { buildSourceQueue } from "./sources/queue.js";
import { SOURCE_CATALOG } from "./sources/catalog.js";

const BATCH_LIMIT = 40;
// A source that has left the catalog. Plans saved before then may still hold its tasks;
// they are never run and never queued again.
const RETIRED_SOURCE_ID = "cn-24365";

function jobsForTask(jobs, taskId) {
  return jobs.filter((job) => job.sourceTaskId === taskId || job.sourceTaskIds?.includes(taskId));
}

// One discovery run for one workspace: pick the batch, read the sources that have a
// reader, give the remaining tasks to the local model, then record what happened and
// what is left. Jobs are saved as they arrive, so a pause or failure keeps them.
export function createDiscovery({ store, sourceSessionController, localModel, normalizeJobs }) {
  function saveJobs(current, jobs) {
    current.jobs = deduplicateJobs([
      ...current.jobs,
      ...normalizeJobs(jobs, current.preferences, current.searchPlan),
    ]);
  }

  // Which tasks run now. An automatic continuation skips sources and tasks that stopped
  // for a login or a failure, unless the source the user just signed in to is now readable.
  async function selectBatch(workspace, { automatic, resumeSource }) {
    let queue = workspace.searchQueue ?? buildSourceQueue(workspace.searchPlan);
    const blockedSources = new Set(
      automatic ? (workspace.searchContinuation?.blockedSourceIds ?? []) : [],
    );
    const blockedTasks = new Set(
      automatic ? (workspace.searchContinuation?.blockedTaskIds ?? []) : [],
    );
    if (automatic && resumeSource && blockedSources.has(resumeSource)) {
      const connection = (await sourceSessionController.list()).find(
        (candidate) => candidate.sourceId === resumeSource,
      );
      if (
        connection?.extraction === "ready" &&
        ["signed_in", "not_required"].includes(connection.authentication) &&
        !connection.lastFailure
      ) {
        blockedSources.delete(resumeSource);
        for (const task of workspace.searchPlan) {
          const stopReason = workspace.sourceCheckpoints?.[task.id]?.stopReason;
          if (
            task.sourceId === resumeSource &&
            ["sign_in_required", "challenge_required"].includes(stopReason)
          ) {
            blockedTasks.delete(task.id);
          }
        }
      }
    }
    if (!queue.executeIds.length && !automatic) queue = buildSourceQueue(workspace.searchPlan);
    const allRemainingIds = [...queue.executeIds, ...queue.queuedIds].filter((id) =>
      workspace.searchPlan.some((task) => task.id === id && task.sourceId !== RETIRED_SOURCE_ID),
    );
    const runnableIds = allRemainingIds.filter((id) => {
      const task = workspace.searchPlan.find((entry) => entry.id === id);
      return !blockedSources.has(task.sourceId) && !blockedTasks.has(id);
    });
    queue = {
      ...queue,
      executeIds: runnableIds.slice(0, BATCH_LIMIT),
      queuedIds: runnableIds.slice(BATCH_LIMIT),
    };
    const activePlan = queue.executeIds
      .map((id) => workspace.searchPlan.find((entry) => entry.id === id))
      .filter((entry) => entry && entry.sourceId !== RETIRED_SOURCE_ID);
    return {
      queue,
      allRemainingIds,
      activeIds: new Set(queue.executeIds),
      activePlan,
      blockedSources,
      blockedTasks,
    };
  }

  // A task that finished last time starts over, keeping its last coverage for comparison;
  // an unfinished one resumes where it stopped.
  function startCheckpoints(current, activePlan) {
    current.sourceCheckpoints ??= {};
    for (const task of activePlan) {
      const prior = current.sourceCheckpoints[task.id];
      current.sourceCheckpoints[task.id] = {
        ...(prior?.complete
          ? {
              previousCoverage: {
                complete: true,
                pagesRead: prior.pagesRead,
                uniqueJobs: prior.uniqueJobs,
              },
            }
          : (prior ?? {})),
        pagesRead: prior?.complete ? 0 : (prior?.pagesRead ?? 0),
        uniqueJobs: prior?.complete ? 0 : (prior?.uniqueJobs ?? 0),
        complete: false,
        nextUrl: prior?.complete ? task.searchUrl : (prior?.nextUrl ?? task.searchUrl),
        stopReason: "running",
        attemptStartedAt: new Date().toISOString(),
      };
    }
    return current;
  }

  async function readSources(run, activePlan, priorCheckpoints) {
    const readerTasks = activePlan.filter((entry) => {
      const source = SOURCE_CATALOG.find((candidate) => candidate.id === entry.sourceId);
      return Boolean(source?.adapterId);
    });
    const result = { jobs: [], completedTaskIds: [], failedTasks: [], unsupportedTaskIds: [] };
    if (!readerTasks.length) return result;
    try {
      return await sourceSessionController.discover(
        readerTasks.map((task) => ({
          ...task,
          resumeUrl: priorCheckpoints[task.id]?.complete
            ? undefined
            : priorCheckpoints[task.id]?.nextUrl,
        })),
        {
          shouldStop: () => run.control.cancelled,
          onProgress: async (task, progress) => {
            run.workspace = await store.updateWorkspace(run.workspaceId, async (current) => {
              saveJobs(current, progress.jobs);
              const scan = {
                ...mergeScanProgress(priorCheckpoints[task.id], progress.scan),
                uniqueJobs: jobsForTask(current.jobs, task.id).length,
              };
              current.sourceCheckpoints = {
                ...current.sourceCheckpoints,
                [task.id]: { ...current.sourceCheckpoints?.[task.id], ...scan },
              };
              current.scanProgress = {
                taskId: task.id,
                sourceId: task.sourceId,
                ...scan,
                updatedAt: new Date().toISOString(),
              };
              return current;
            });
          },
        },
      );
    } catch (error) {
      if (error.code === "desktop_required") {
        result.unsupportedTaskIds = readerTasks.map((task) => task.id);
      } else {
        result.failedTasks = readerTasks.map((task) => ({
          taskId: task.id,
          sourceId: task.sourceId,
          code: "source_run_failed",
          message: "Source search interrupted; saved pages retained / 搜索中断，已保存已读页面",
        }));
      }
      return result;
    }
  }

  // The local model may report tasks it has no tool for, and tasks that failed on their
  // own, instead of failing the whole batch.
  async function screenWithLocalModel(run, plan) {
    const outcome = {
      jobs: [],
      failure: null,
      unsupported: new Set(),
      failedTasks: [],
      scans: new Map(),
    };
    if (!plan.length || run.control.cancelled) return outcome;
    try {
      if (!localModel) throw new TypeError("No local model is configured / 未配置本地模型");
      let status = await localModel.status();
      if (status.state === "missing" && (await localModel.ensureRunning?.())) {
        status = await localModel.status();
      }
      if (status.state !== "ready") {
        throw new TypeError(
          `Local model unavailable; AI tasks wait until Ollama is running / 本地模型不可用，AI 任务等 Ollama 运行后再搜索${status.detail ? `（${status.detail}）` : ""}`,
        );
      }
      const result = await localModel.discover(
        {
          redactedResume: run.workspace.resume.redactedPreview,
          plan,
          incremental: {
            scanSince: run.workspace.lastDiscoveryAt ?? null,
            overlapHours: 48,
            knownJobCount: run.workspace.jobs.length,
          },
        },
        {
          shouldStop: () => run.control.cancelled,
          // Saved as each task finishes, so the job list and progress line move during a
          // long local-model run and a pause keeps what was already found.
          onTaskDone: async (task, progress) => {
            run.workspace = await store.updateWorkspace(run.workspaceId, async (current) => {
              saveJobs(current, progress.jobs);
              current.scanProgress = {
                taskId: task.id,
                sourceId: task.sourceId,
                pagesRead: progress.pagesRead,
                uniqueJobs: jobsForTask(current.jobs, task.id).length,
                stopReason: "running",
                updatedAt: new Date().toISOString(),
              };
              return current;
            });
          },
        },
      );
      outcome.jobs = result.jobs;
      outcome.unsupported = new Set(result.unsupportedTaskIds ?? []);
      outcome.failedTasks = result.failedTasks ?? [];
      outcome.scans = new Map((result.scans ?? []).map((scan) => [scan.taskId, scan]));
    } catch (error) {
      outcome.failure = {
        code: "provider_search_failed",
        message: error.message ?? "AI search unavailable / AI 搜索暂不可用",
      };
    }
    return outcome;
  }

  function modelStopReason(run, model, taskId, failed) {
    if (run.control.cancelled) return "cancelled";
    if (model.failure) return "provider_search_failed";
    if (model.unsupported.has(taskId)) return "provider_source_unsupported";
    if (failed) return failed.code;
    return "provider_results_unverified";
  }

  // Everything a run learned goes into one save: the jobs, how each task stopped, which
  // sources and tasks an automatic continuation should skip, and the next batch.
  function recordOutcome(current, run, batch, readers, modelPlan, model) {
    const { blockedSources, blockedTasks } = batch;
    const cancelled = run.control.cancelled;
    saveJobs(current, [...readers.jobs, ...model.jobs]);
    current.lastSourceAdapterRun = {
      completedTaskIds: readers.completedTaskIds,
      failedTasks: readers.failedTasks,
      unsupportedTaskIds: readers.unsupportedTaskIds,
      pendingTasks: readers.pendingTasks ?? [],
      scans: readers.scans ?? [],
      ...(model.failure ? { providerFailure: model.failure } : {}),
      ...(model.unsupported.size ? { providerUnsupportedTaskIds: [...model.unsupported] } : {}),
      ...(model.failedTasks.length ? { providerFailedTasks: model.failedTasks } : {}),
    };
    const modelFailed = new Map(model.failedTasks.map((failure) => [failure.taskId, failure]));
    const executedIds = new Set([
      ...readers.completedTaskIds,
      ...(!cancelled && !model.failure
        ? modelPlan
            .map((entry) => entry.id)
            .filter((id) => !model.unsupported.has(id) && !modelFailed.has(id))
        : []),
    ]);
    current.lastExecutedTaskIds = batch.queue.executeIds.filter((id) => executedIds.has(id));

    const pendingTasks = readers.pendingTasks ?? [];
    // A page or scroll limit is a pause, not a problem; anything else blocks the source.
    for (const failure of [
      ...readers.failedTasks,
      ...pendingTasks.filter((task) => !["page_limit", "scroll_limit"].includes(task.code)),
    ]) {
      current.sourceCheckpoints[failure.taskId] = {
        ...current.sourceCheckpoints[failure.taskId],
        complete: false,
        stopReason: failure.code,
      };
      blockedTasks.add(failure.taskId);
      const sourceId =
        failure.sourceId ?? current.searchPlan.find((task) => task.id === failure.taskId)?.sourceId;
      if (sourceId) blockedSources.add(sourceId);
    }
    for (const task of modelPlan) {
      const failed = modelFailed.get(task.id);
      current.sourceCheckpoints[task.id] = {
        ...current.sourceCheckpoints[task.id],
        complete: false,
        uniqueJobs: jobsForTask(current.jobs, task.id).length,
        pagesRead:
          model.scans.get(task.id)?.pagesRead ?? current.sourceCheckpoints[task.id]?.pagesRead ?? 0,
        stopReason: modelStopReason(run, model, task.id, failed),
      };
      if (model.failure || failed || model.unsupported.has(task.id)) blockedTasks.add(task.id);
    }
    const lastProgress = current.scanProgress;
    if (
      lastProgress?.stopReason === "running" &&
      modelPlan.some((task) => task.id === lastProgress.taskId)
    ) {
      current.scanProgress = {
        ...lastProgress,
        stopReason:
          current.sourceCheckpoints[lastProgress.taskId]?.stopReason ??
          "provider_results_unverified",
      };
    }

    const remainingIds = [
      ...new Set([
        ...pendingTasks.filter((task) => task.code === "scroll_limit").map((task) => task.taskId),
        ...batch.allRemainingIds.filter((id) => !batch.activeIds.has(id)),
        ...batch.queue.queuedIds.filter((id) => !id.includes(`:${RETIRED_SOURCE_ID}:`)),
        ...pendingTasks.filter((task) => task.code === "page_limit").map((task) => task.taskId),
        ...readers.failedTasks.map((failure) => failure.taskId),
        ...pendingTasks.filter((task) => task.code !== "page_limit").map((task) => task.taskId),
        ...(cancelled || model.failure ? modelPlan.map((entry) => entry.id) : []),
        ...modelFailed.keys(),
      ]),
    ];
    const automaticIds = remainingIds.filter((id) => {
      const task = current.searchPlan.find((entry) => entry.id === id);
      return task && !blockedTasks.has(id) && !blockedSources.has(task.sourceId);
    });
    current.searchContinuation = {
      automaticAvailable: !cancelled && automaticIds.length > 0,
      remainingCount: remainingIds.length,
      blockedSourceIds: [...blockedSources],
      blockedTaskIds: [...blockedTasks],
    };
    current.searchQueue = remainingIds.length
      ? {
          executeIds: remainingIds.slice(0, BATCH_LIMIT),
          queuedIds: remainingIds.slice(BATCH_LIMIT),
          total: remainingIds.length,
          limit: BATCH_LIMIT,
        }
      : { executeIds: [], queuedIds: [], total: 0, limit: BATCH_LIMIT };
    if (!remainingIds.length) current.lastDiscoveryAt = new Date().toISOString();
    return current;
  }

  return async function runDiscovery(workspaceId, { automatic, resumeSource, control }) {
    const run = { workspaceId, control, workspace: null };
    run.workspace = await store.runExclusive(workspaceId, () => store.loadWorkspace(workspaceId));
    if (!run.workspace.resume?.redactedPreview) {
      throw new TypeError("Import and approve a resume preview first");
    }
    if (!run.workspace.searchPlan?.length) {
      throw new TypeError("Generate a search plan first");
    }
    const batch = await selectBatch(run.workspace, { automatic, resumeSource });
    const priorCheckpoints = structuredClone(run.workspace.sourceCheckpoints ?? {});
    run.workspace = await store.updateWorkspace(workspaceId, (current) =>
      startCheckpoints(current, batch.activePlan),
    );
    const readers = await readSources(run, batch.activePlan, priorCheckpoints);
    const handled = new Set([
      ...readers.completedTaskIds,
      ...readers.failedTasks.map((failure) => failure.taskId),
      ...(readers.pendingTasks ?? []).map((task) => task.taskId),
    ]);
    const modelPlan = batch.activePlan.filter((entry) => !handled.has(entry.id));
    const model = await screenWithLocalModel(run, modelPlan);
    run.workspace = await store.updateWorkspace(workspaceId, async (current) =>
      recordOutcome(current, run, batch, readers, modelPlan, model),
    );
    return run.workspace;
  };
}

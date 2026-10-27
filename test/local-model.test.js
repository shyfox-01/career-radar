import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { LocalModelError, pickToolModel, resolveOllamaUrl } from "../src/providers/local/ollama.js";
import { createMyCareersFutureSearch } from "../src/providers/local/mycareersfuture.js";
import { runLocalTask, seedQuery } from "../src/providers/local/agent.js";
import { createOllamaProvider } from "../src/providers/ollama.js";
import { validateProviderContract } from "../src/providers/provider.js";
import { createCareerRadarServer } from "../src/server.js";

function record(n, overrides = {}) {
  const uuid = n.toString(16).padStart(32, "0");
  return {
    uuid,
    title: `Data Analyst ${n}`,
    description: "<p>Use <strong>SQL</strong> &amp; Python.</p><ul><li>Dashboards</li></ul>",
    postedCompany: { name: `Synthetic Company ${n}` },
    address: {
      isOverseas: false,
      districts: [{ location: "D01 Cecil, Marina, People's Park, Raffles Place" }],
    },
    salary: { minimum: 3000, maximum: 4500, type: { salaryType: "Monthly" } },
    employmentTypes: [{ employmentType: "Full Time" }],
    positionLevels: [{ position: "Junior Executive" }],
    minimumYearsExperience: 1,
    skills: [{ skill: "SQL" }, { skill: "Python" }],
    categories: [{ category: "Information Technology" }],
    status: { jobStatus: "Open" },
    metadata: {
      newPostingDate: "2026-10-10",
      expiryDate: "2026-11-09",
      jobDetailsUrl: `https://www.mycareersfuture.gov.sg/job/information-technology/data-analyst-synthetic-${uuid}`,
    },
    ...overrides,
  };
}

// Like the real API: search results are summaries without a description or minimum
// experience, and each job's own record carries those. `results` may depend on the page.
function fakeMcf(results = [record(1), record(2)], { failDetails = false } = {}) {
  const searches = [];
  const served = new Map();
  const search = createMyCareersFutureSearch({
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(url);
      if (init.method === "POST") {
        searches.push({ url: parsed, body: JSON.parse(init.body) });
        const list =
          typeof results === "function"
            ? results(Number(parsed.searchParams.get("page")))
            : results;
        for (const entry of list) served.set(entry.uuid, entry);
        const summaries = list.map(
          ({ description, minimumYearsExperience, ...summary }) => summary,
        );
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: summaries, total: list.length }),
        };
      }
      const entry = served.get(parsed.pathname.split("/").pop());
      if (failDetails || !entry) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => entry };
    },
  });
  return { search, searches };
}

function scriptedClient(
  steps,
  models = [{ name: "qwen3.5:9b", size: 6e9, capabilities: ["completion", "tools"] }],
) {
  const requests = [];
  return {
    requests,
    listModels: async () => models,
    chat: async (request) => {
      requests.push(structuredClone(request));
      const step = steps[Math.min(requests.length - 1, steps.length - 1)];
      if (step instanceof Error) throw step;
      return { message: typeof step === "function" ? step(request) : step };
    },
  };
}

const call = (name, args) => ({ function: { name, arguments: args } });
const task = {
  id: "SG:sg-mcf:dynamic:full_time:Data Analyst",
  market: "SG",
  sourceId: "sg-mcf",
  roleTitle: "Data Analyst",
  employmentType: "full_time",
  query: "Data Analyst full time",
};

test("the local model server must be on this machine", () => {
  assert.equal(resolveOllamaUrl(""), "http://127.0.0.1:11434");
  assert.equal(resolveOllamaUrl("http://localhost:1234/v1"), "http://localhost:1234");
  assert.equal(resolveOllamaUrl("http://[::1]:11434"), "http://[::1]:11434");
  for (const remote of [
    "http://192.168.1.5:11434",
    "https://ollama.example.com",
    "http://user:secret@127.0.0.1:11434",
    "ftp://127.0.0.1",
    "not a url",
  ]) {
    assert.throws(() => resolveOllamaUrl(remote), TypeError, remote);
  }
});

test("the configured model wins, otherwise the smallest tool-capable model", () => {
  const models = [
    { name: "qwen3.5:27b", size: 17e9, capabilities: ["completion", "tools"] },
    { name: "qwen3.5:9b", size: 6e9, capabilities: ["completion", "tools"] },
    { name: "tiny:latest", size: 1e9, capabilities: ["completion"] },
  ];
  assert.deepEqual(pickToolModel(models, ""), { model: "qwen3.5:9b", reason: null });
  assert.equal(pickToolModel(models, "qwen3.5:27b").model, "qwen3.5:27b");
  assert.equal(pickToolModel(models, "tiny").model, null);
  assert.match(pickToolModel(models, "tiny").reason, /tool calling/u);
  assert.match(pickToolModel(models, "absent").reason, /not installed/u);
  assert.equal(pickToolModel([models[2]], "").model, null);
});

test("MyCareersFuture listings keep only records with their own job link, title and company", async () => {
  const { search, searches } = fakeMcf([
    record(1),
    record(2, {
      metadata: {
        jobDetailsUrl: "https://elsewhere.example/job/a/b-00000000000000000000000000000002",
      },
    }),
    record(3, { postedCompany: { name: " " } }),
    record(4, { status: { jobStatus: "Closed" } }),
    record(5, { metadata: {} }),
  ]);
  const result = await search.search({ query: "Data Analyst", employmentType: "internship" });
  assert.equal(searches[0].url.hostname, "api.mycareersfuture.gov.sg");
  assert.deepEqual(searches[0].body, {
    search: "Data Analyst",
    employmentTypes: ["Internship/Attachment"],
  });
  assert.equal(result.listings.length, 1);
  const [listing] = result.listings;
  assert.equal(
    listing.url,
    "https://www.mycareersfuture.gov.sg/job/information-technology/data-analyst-synthetic-00000000000000000000000000000001",
  );
  assert.equal(listing.description, "Use SQL & Python.\n• Dashboards");
  assert.equal(listing.salary, "SGD 3000–4500 Monthly");
  await assert.rejects(search.search({ query: " " }), TypeError);
});

test("a listing whose detail record cannot be read is kept without a description", async () => {
  const { search } = fakeMcf([record(1)], { failDetails: true });
  const [listing] = (await search.search({ query: "Data Analyst" })).listings;
  assert.equal(listing.title, "Data Analyst 1");
  assert.equal(listing.description, "");
  assert.equal(listing.minimumYearsExperience, null);
});

test("a saved job takes every fact from the source; refs the model invents are refused", async () => {
  const { search, searches } = fakeMcf();
  const client = scriptedClient([
    {
      content: "",
      tool_calls: [
        call("save_jobs", {
          jobs: [
            {
              ref: "J1",
              match_reasons: ["SQL and Python appear in the resume"],
              missing_requirements: [],
            },
            { ref: "J9", match_reasons: ["made up"], missing_requirements: [] },
            {
              ref: "https://invented.example/job/1",
              match_reasons: ["made up"],
              missing_requirements: [],
            },
          ],
        }),
      ],
    },
    { content: "", tool_calls: [call("finish", { summary: "done" })] },
  ]);
  const result = await runLocalTask({
    client,
    model: "qwen3.5:9b",
    task,
    redactedResume: "Synthetic candidate with SQL and Python",
    search,
  });
  assert.deepEqual(searches[0].body, { search: "Data Analyst", employmentTypes: ["Full Time"] });
  assert.equal(result.stopReason, "finished");
  assert.equal(result.jobs.length, 1);
  const [job] = result.jobs;
  assert.equal(job.title, "Data Analyst 1");
  assert.equal(job.company, "Synthetic Company 1");
  assert.equal(
    job.url,
    "https://www.mycareersfuture.gov.sg/job/information-technology/data-analyst-synthetic-00000000000000000000000000000001",
  );
  assert.equal(job.verification, "source_checked");
  assert.equal(job.employmentType, "full_time");
  assert.equal(job.sourceTaskId, task.id);
  assert.deepEqual(job.matchReasons, ["SQL and Python appear in the resume"]);
  const firstPrompt = client.requests[0].messages[1].content;
  assert.match(firstPrompt, /Synthetic candidate with SQL and Python/u);
  assert.match(firstPrompt, /^J1 \| Data Analyst 1 \| Synthetic Company 1/mu);
  const saveResult = client.requests[1].messages.find((message) => message.role === "tool").content;
  assert.match(saveResult, /Not accepted, not from any search result: J9, HTTPS:\/\/INVENTED/u);
});

test("a vacancy listed as part time and full time counts as full time in a full-time search", async () => {
  const both = record(1, {
    employmentTypes: [{ employmentType: "Part Time" }, { employmentType: "Full Time" }],
  });
  const intern = record(2, {
    title: "Data Analyst Intern",
    employmentTypes: [{ employmentType: "Full Time" }],
  });
  const { search } = fakeMcf([both, intern]);
  const client = scriptedClient([
    {
      content: "",
      tool_calls: [
        call("save_jobs", {
          jobs: [
            { ref: "J1", match_reasons: ["fit"], missing_requirements: [] },
            { ref: "J2", match_reasons: ["fit"], missing_requirements: [] },
          ],
        }),
        call("finish", { summary: "" }),
      ],
    },
  ]);
  const result = await runLocalTask({ client, model: "m", task, redactedResume: "x", search });
  assert.deepEqual(
    result.jobs.map((job) => job.employmentType),
    ["full_time", "internship"],
  );
  const unfiltered = await search.search({ query: "Data Analyst" });
  assert.equal(unfiltered.listings[0].employmentText, "Part Time Full Time");
});

test("the session ends on repeated calls, on silence, and at the step limit", async () => {
  const repeat = scriptedClient([
    { content: "", tool_calls: [call("search_jobs", { query: "Data Analyst" })] },
  ]);
  const repeated = await runLocalTask({
    client: repeat,
    model: "m",
    task,
    redactedResume: "x",
    search: fakeMcf().search,
  });
  assert.equal(repeated.stopReason, "unproductive");
  assert.equal(repeat.requests.length, 3);

  const silent = scriptedClient([{ content: "Here are some jobs I remember." }]);
  const quiet = await runLocalTask({
    client: silent,
    model: "m",
    task,
    redactedResume: "x",
    search: fakeMcf().search,
  });
  assert.equal(quiet.stopReason, "model_stopped");
  assert.equal(quiet.jobs.length, 0);
  assert.equal(silent.requests.length, 2);

  const paged = fakeMcf((page) => [record(10 + page), record(20 + page)]).search;
  let page = 0;
  const busy = scriptedClient([
    () => ({
      content: "",
      tool_calls: [
        call("job_details", { ref: "J1" }),
        call("search_jobs", { query: "Analyst", page: ++page }),
      ],
    }),
  ]);
  const capped = await runLocalTask({
    client: busy,
    model: "m",
    task,
    redactedResume: "x",
    search: paged,
    maxSteps: 4,
  });
  assert.equal(capped.stopReason, "step_limit");
  assert.equal(capped.searches, 4);
  assert.equal(busy.requests.length, 4);
  assert.match(busy.requests[2].messages.at(-1).content, /Almost out of steps/u);
});

test("a listing saved without a reason in the candidate's favour is refused", async () => {
  const client = scriptedClient([
    {
      content: "",
      tool_calls: [
        call("save_jobs", {
          jobs: [
            { ref: "J1", match_reasons: ["SQL in both"], missing_requirements: [] },
            { ref: "J2", match_reasons: [" "], missing_requirements: ["8 years of experience"] },
          ],
        }),
      ],
    },
    { content: "", tool_calls: [call("finish", { summary: "" })] },
  ]);
  const result = await runLocalTask({
    client,
    model: "m",
    task,
    redactedResume: "x",
    search: fakeMcf().search,
  });
  assert.deepEqual(
    result.jobs.map((job) => job.title),
    ["Data Analyst 1"],
  );
  const reply = client.requests[1].messages.find((message) => message.role === "tool").content;
  assert.match(reply, /Not saved, no reason in the candidate's favour: J2/u);
});

test("the same vacancy posted twice under new links is shown and saved once", async () => {
  const twin = record(2, {
    title: "Data Analyst 1",
    postedCompany: { name: "Synthetic Company 1" },
  });
  const client = scriptedClient([
    {
      content: "",
      tool_calls: [
        call("save_jobs", {
          jobs: [
            { ref: "J1", match_reasons: ["SQL in both"], missing_requirements: [] },
            { ref: "J2", match_reasons: ["SQL in both"], missing_requirements: [] },
          ],
        }),
        call("finish", { summary: "" }),
      ],
    },
  ]);
  const result = await runLocalTask({
    client,
    model: "m",
    task,
    redactedResume: "x",
    search: fakeMcf([record(1), twin]).search,
  });
  const prompt = client.requests[0].messages[1].content;
  assert.match(prompt, /1 shown/u);
  assert.doesNotMatch(prompt, /^J2 \|/mu);
  assert.equal(result.listingsSeen, 1);
  assert.equal(result.jobs.length, 1);
});

test("seed queries drop the employment term the plan appended", () => {
  assert.equal(seedQuery(task), "Data Analyst");
  assert.equal(
    seedQuery({ ...task, employmentType: "internship", query: "Data Analyst internship" }),
    "Data Analyst",
  );
  assert.equal(seedQuery({ ...task, query: "Quant Researcher" }), "Quant Researcher");
});

test("the provider searches only sources it has a tool for and stops after losing the model", async () => {
  const mcfTask = (n) => ({ ...task, id: `${task.id}:${n}` });
  const linkedInTask = {
    ...task,
    id: "SG:sg-linkedin:dynamic:full_time:Data Analyst",
    sourceId: "sg-linkedin",
  };
  const working = createOllamaProvider({
    client: scriptedClient([
      {
        content: "",
        tool_calls: [
          call("save_jobs", {
            jobs: [{ ref: "J2", match_reasons: ["fit"], missing_requirements: ["2 years"] }],
          }),
          call("finish", { summary: "ok" }),
        ],
      },
    ]),
    searchTools: [fakeMcf().search],
  });
  validateProviderContract(working);
  const status = await working.status();
  assert.equal(status.state, "ready");
  assert.equal(status.model, "qwen3.5:9b");
  assert.deepEqual(status.capabilities.sourceIds, ["sg-mcf"]);
  const result = await working.discover({ redactedResume: "x", plan: [mcfTask(1), linkedInTask] });
  assert.deepEqual(result.unsupportedTaskIds, [linkedInTask.id]);
  assert.deepEqual(result.completedTaskIds, [mcfTask(1).id]);
  assert.equal(result.jobs[0].title, "Data Analyst 2");

  const lost = scriptedClient([new LocalModelError("local_model_unreachable", "gone")]);
  const broken = createOllamaProvider({ client: lost, searchTools: [fakeMcf().search] });
  const failed = await broken.discover({ redactedResume: "x", plan: [mcfTask(1), mcfTask(2)] });
  assert.deepEqual(
    failed.failedTasks.map((failure) => [failure.taskId, failure.code]),
    [
      [mcfTask(1).id, "local_model_unreachable"],
      [mcfTask(2).id, "local_model_unreachable"],
    ],
  );
  assert.equal(lost.requests.length, 1);
});

test("opening the interface starts loading a ready model, and only a ready one", async () => {
  const root = await mkdtemp(path.resolve(".career-radar-data", "warm-"));
  const warmed = [];
  const ready = {
    ...scriptedClient([]),
    warm: async (request) => {
      warmed.push(request);
      return {};
    },
  };
  const server = createCareerRadarServer({
    dataRoot: root,
    localModelProvider: createOllamaProvider({ client: ready, searchTools: [] }),
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const status = await (
      await fetch(`http://127.0.0.1:${server.address().port}/api/local-model`)
    ).json();
    assert.equal(status.state, "ready");
    for (let i = 0; i < 20 && !warmed.length; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(warmed, [{ model: "qwen3.5:9b" }]);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
  const missing = {
    listModels: async () => {
      throw new LocalModelError("local_model_unreachable", "No Ollama server");
    },
    warm: async () => {
      throw new Error("must not warm");
    },
  };
  await createOllamaProvider({ client: missing, searchTools: [] }).prepare();
});

test("provider status explains a missing server or a model without tools", async () => {
  const offline = createOllamaProvider({
    client: {
      listModels: async () => {
        throw new LocalModelError("local_model_unreachable", "No Ollama server");
      },
    },
    searchTools: [],
  });
  assert.equal((await offline.status()).state, "missing");
  await assert.rejects(offline.discover({ plan: [] }), /No Ollama server/u);
  const noTools = createOllamaProvider({
    client: scriptedClient([], [{ name: "tiny:latest", size: 1, capabilities: ["completion"] }]),
    searchTools: [],
  });
  const status = await noTools.status();
  assert.equal(status.state, "incompatible");
  assert.match(status.detail, /tool calling/u);
});

test("a workspace without a choice uses only the local model, and waits when it is not running", async () => {
  const saveFirst = {
    content: "",
    tool_calls: [
      call("save_jobs", {
        jobs: [{ ref: "J1", match_reasons: ["fit"], missing_requirements: [] }],
      }),
      call("finish", { summary: "" }),
    ],
  };
  const plan = [
    {
      ...task,
      id: "mcf",
      searchUrl: "https://www.mycareersfuture.gov.sg/search?search=Data%20Analyst",
    },
  ];
  async function run({ ollamaReady, choose }) {
    const root = await mkdtemp(path.resolve(".career-radar-data", "default-provider-"));
    let codexCalls = 0;
    const codex = {
      id: "codex",
      name: "Fake Codex",
      detect: async () => ({ installed: true }),
      status: async () => ({ id: "codex", state: "ready" }),
      capabilities: () => ({ discovery: true }),
      discover: async () => {
        codexCalls += 1;
        return { jobs: [] };
      },
    };
    const client = ollamaReady
      ? scriptedClient([saveFirst])
      : {
          listModels: async () => {
            throw new LocalModelError("local_model_unreachable", "No Ollama server");
          },
        };
    const ollama = createOllamaProvider({ client, searchTools: [fakeMcf().search] });
    const server = createCareerRadarServer({ dataRoot: root, localModelProvider: ollama });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const request = async (suffix, method = "GET", body) =>
      (
        await fetch(`${origin}${suffix}`, {
          method,
          headers: { "content-type": "application/json" },
          ...(body ? { body: JSON.stringify(body) } : {}),
        })
      ).json();
    try {
      await request("/api/workspaces/test", "PUT", {
        jobs: [],
        resume: { redactedPreview: "Synthetic candidate" },
        searchPlan: plan,
        searchQueue: { executeIds: ["mcf"], queuedIds: [] },
      });
      const defaults = [(await request("/api/local-model")).id];
      const workspace = await request("/api/workspaces/test/discover", "POST");
      return {
        defaults,
        codexCalls,
        localJobs: workspace.jobs.length,
        failure: workspace.lastSourceAdapterRun.providerFailure?.message ?? null,
        stopReason: workspace.sourceCheckpoints.mcf.stopReason,
        waiting: workspace.searchQueue.executeIds,
      };
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  }
  const ready = await run({ ollamaReady: true });
  assert.deepEqual(
    [ready.defaults, ready.codexCalls, ready.localJobs, ready.failure],
    [["ollama"], 0, 1, null],
  );

  const offline = await run({ ollamaReady: false });
  assert.deepEqual([offline.defaults, offline.codexCalls, offline.localJobs], [["ollama"], 0, 0]);
  assert.match(offline.failure, /本地模型不可用/u);
  assert.equal(offline.stopReason, "provider_search_failed");
  assert.deepEqual(offline.waiting, ["mcf"]);
});

test("discovery records local-model results, unsupported sources and failed tasks separately", async () => {
  const root = await mkdtemp(path.resolve(".career-radar-data", "local-model-"));
  let mcfCalls = 0;
  const client = scriptedClient([
    (request) => {
      const prompt = request.messages[1].content;
      if (prompt.includes("Target role: Broken"))
        throw new LocalModelError("local_model_failed", "Ollama HTTP 500");
      mcfCalls += 1;
      return {
        content: "",
        tool_calls: [
          call("save_jobs", {
            jobs: [{ ref: "J1", match_reasons: ["fit"], missing_requirements: [] }],
          }),
          call("finish", { summary: "ok" }),
        ],
      };
    },
  ]);
  const provider = createOllamaProvider({ client, searchTools: [fakeMcf().search] });
  const server = createCareerRadarServer({ dataRoot: root, localModelProvider: provider });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const api = async (suffix, method = "GET", body) => {
    const response = await fetch(`${origin}/api/workspaces/test${suffix}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  try {
    const plan = [
      {
        ...task,
        id: "mcf-ok",
        searchUrl: "https://www.mycareersfuture.gov.sg/search?search=Data%20Analyst",
      },
      {
        ...task,
        id: "mcf-broken",
        roleTitle: "Broken",
        query: "Broken full time",
        searchUrl: "https://www.mycareersfuture.gov.sg/search?search=Broken",
      },
      {
        ...task,
        id: "internsg",
        sourceId: "sg-internsg",
        searchUrl: "https://www.internsg.com/?s=Data%20Analyst",
      },
    ];
    await api("", "PUT", {
      jobs: [],
      resume: { redactedPreview: "Synthetic candidate" },
      searchPlan: plan,
      searchQueue: { executeIds: plan.map((entry) => entry.id), queuedIds: [] },
    });
    const result = await api("/discover", "POST");
    assert.equal(mcfCalls, 1);
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].verification, "source_checked");
    assert.equal(result.sourceCheckpoints["mcf-ok"].stopReason, "provider_results_unverified");
    assert.equal(result.sourceCheckpoints["mcf-ok"].uniqueJobs, 1);
    assert.equal(result.sourceCheckpoints["mcf-ok"].pagesRead, 1);
    assert.equal(result.scanProgress.taskId, "mcf-ok");
    assert.equal(result.scanProgress.stopReason, "provider_results_unverified");
    assert.equal(result.sourceCheckpoints.internsg.uniqueJobs, 0);
    assert.equal(result.sourceCheckpoints["mcf-broken"].stopReason, "local_model_failed");
    assert.equal(result.sourceCheckpoints.internsg.stopReason, "provider_source_unsupported");
    assert.deepEqual(result.lastExecutedTaskIds, ["mcf-ok"]);
    assert.deepEqual(result.lastSourceAdapterRun.providerUnsupportedTaskIds, ["internsg"]);
    assert.deepEqual(
      result.lastSourceAdapterRun.providerFailedTasks.map((failure) => failure.taskId),
      ["mcf-broken"],
    );
    assert.deepEqual(result.searchQueue.executeIds, ["mcf-broken"]);
    assert.equal(result.searchContinuation.automaticAvailable, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

test("the installed Ollama is found where its installer puts it", async () => {
  const { findOllamaLauncher } = await import("../src/providers/local/launch.js");
  const env = { LOCALAPPDATA: "C:\\Users\\someone\\AppData\\Local" };
  const tray = findOllamaLauncher({
    env,
    platform: "win32",
    exists: (file) => file.endsWith("ollama app.exe"),
  });
  assert.match(tray.command, /Programs[\\/]Ollama[\\/]ollama app\.exe$/u);
  assert.deepEqual(tray.args, []);
  const server = findOllamaLauncher({
    env,
    platform: "win32",
    exists: (file) => file.endsWith("ollama.exe"),
  });
  assert.deepEqual(server.args, ["serve"]);
  assert.deepEqual(findOllamaLauncher({ env: {}, platform: "darwin", exists: () => true }), {
    command: "open",
    args: ["-a", "Ollama"],
  });
  assert.deepEqual(findOllamaLauncher({ env: {}, platform: "linux", exists: () => false }), {
    command: "ollama",
    args: ["serve"],
  });
});

test("launching Ollama runs it detached, without a shell, and reports a failure", async () => {
  const { EventEmitter } = await import("node:events");
  const { launchOllama } = await import("../src/providers/local/launch.js");
  const calls = [];
  const fakeSpawn = (outcome) => (command, args, options) => {
    calls.push({ command, args, options });
    const child = Object.assign(new EventEmitter(), {
      unref() {
        child.unrefed = true;
      },
    });
    setImmediate(() => child.emit(outcome, new Error("ENOENT")));
    return child;
  };
  assert.equal(
    await launchOllama({ command: "ollama", args: ["serve"] }, { spawnImpl: fakeSpawn("spawn") }),
    true,
  );
  assert.deepEqual(calls[0].options, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: false,
  });
  assert.equal(
    await launchOllama({ command: "ollama", args: ["serve"] }, { spawnImpl: fakeSpawn("error") }),
    false,
  );
  assert.equal(
    await launchOllama(
      { command: "ollama", args: [] },
      {
        spawnImpl: () => {
          throw new Error("blocked");
        },
      },
    ),
    false,
  );
});

test("a stopped Ollama is started once, and a failed start is not retried at once", async () => {
  let running = false;
  let starts = 0;
  let now = 0;
  const client = {
    baseUrl: "http://127.0.0.1:11434",
    listModels: async () => {
      if (!running) throw new LocalModelError("local_model_unreachable", "No Ollama server");
      return [{ name: "qwen3.5:9b", size: 1, capabilities: ["tools"] }];
    },
  };
  const provider = createOllamaProvider({
    client,
    searchTools: [],
    pause: async () => {},
    clock: () => now,
    startServer: async () => {
      starts += 1;
      running = true;
      return true;
    },
  });
  assert.equal((await provider.status()).state, "missing");
  assert.deepEqual(await Promise.all([provider.ensureRunning(), provider.ensureRunning()]), [
    true,
    true,
  ]);
  assert.equal(starts, 1);
  assert.equal((await provider.status()).state, "ready");

  running = false;
  const failing = createOllamaProvider({
    client: { ...client },
    searchTools: [],
    pause: async () => {},
    clock: () => now,
    startWaitMs: 3_000,
    startServer: async () => {
      starts += 1;
      return true;
    },
  });
  assert.equal(await failing.ensureRunning(), false);
  assert.match((await failing.status()).detail, /无法自动启动 Ollama/u);
  assert.equal(await failing.ensureRunning(), false);
  assert.equal(starts, 2);
  now += 61_000;
  await failing.ensureRunning();
  assert.equal(starts, 3);

  const elsewhere = createOllamaProvider({
    client: { ...client, baseUrl: "http://127.0.0.1:1234" },
    searchTools: [],
    pause: async () => {},
    startServer: async () => {
      throw new Error("must not start");
    },
  });
  assert.equal(await elsewhere.ensureRunning(), false);
  assert.equal(await createOllamaProvider({ client, searchTools: [] }).ensureRunning(), false);
});

test("opening the interface or searching starts a stopped Ollama", async () => {
  let running = false;
  const client = {
    ...scriptedClient([
      {
        content: "",
        tool_calls: [
          call("save_jobs", {
            jobs: [{ ref: "J1", match_reasons: ["SQL in both"], missing_requirements: [] }],
          }),
          call("finish", { summary: "" }),
        ],
      },
    ]),
    baseUrl: "http://127.0.0.1:11434",
  };
  const listModels = client.listModels;
  client.listModels = async () => {
    if (!running) throw new LocalModelError("local_model_unreachable", "No Ollama server");
    return listModels();
  };
  const plan = [
    {
      ...task,
      id: "mcf",
      searchUrl: "https://www.mycareersfuture.gov.sg/search?search=Data%20Analyst",
    },
  ];
  for (const route of ["status", "discover"]) {
    running = false;
    const root = await mkdtemp(path.resolve(".career-radar-data", "autostart-"));
    const provider = createOllamaProvider({
      client,
      searchTools: [fakeMcf().search],
      pause: async () => {},
      startServer: async () => {
        running = true;
        return true;
      },
    });
    const server = createCareerRadarServer({ dataRoot: root, localModelProvider: provider });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      if (route === "status") {
        assert.equal((await (await fetch(`${origin}/api/local-model`)).json()).state, "ready");
      } else {
        await fetch(`${origin}/api/workspaces/test`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jobs: [],
            resume: { redactedPreview: "Synthetic" },
            searchPlan: plan,
            searchQueue: { executeIds: ["mcf"], queuedIds: [] },
          }),
        });
        const workspace = await (
          await fetch(`${origin}/api/workspaces/test/discover`, { method: "POST" })
        ).json();
        assert.equal(workspace.lastSourceAdapterRun.providerFailure ?? null, null);
        assert.equal(workspace.jobs.length, 1);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  }
});

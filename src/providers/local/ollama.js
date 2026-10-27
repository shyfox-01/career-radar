export const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

// The redacted resume goes into every request, so only a server on this machine may
// receive it. A remote Ollama address belongs in the API provider configuration.
export function resolveOllamaUrl(value = process.env.CAREER_RADAR_OLLAMA_URL) {
  const raw = String(value ?? "").trim() || DEFAULT_OLLAMA_URL;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new TypeError("Ollama address must be a loopback http URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new TypeError("Ollama address must be a loopback http URL");
  if (!LOOPBACK_HOSTS.has(url.hostname.toLocaleLowerCase("en")) || url.username || url.password) {
    throw new TypeError("Ollama address must be on this machine (127.0.0.1, localhost or ::1)");
  }
  return url.origin;
}

export class LocalModelError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LocalModelError";
    this.code = code;
  }
}

export function createOllamaClient({
  baseUrl = resolveOllamaUrl(),
  fetchImpl = fetch,
  // A 9B model on a laptop GPU answers a tool step in seconds; a cold load or a CPU-only
  // machine can take minutes. Past this, the server is treated as stuck.
  timeoutMs = 300_000,
} = {}) {
  async function call(pathname, init = {}, timeout = timeoutMs) {
    let response;
    try {
      response = await fetchImpl(`${baseUrl}${pathname}`, {
        ...init,
        signal: AbortSignal.timeout(timeout),
      });
    } catch (error) {
      if (error?.name === "TimeoutError")
        throw new LocalModelError(
          "local_model_timeout",
          "The local model did not answer in time / 本地模型响应超时",
        );
      throw new LocalModelError(
        "local_model_unreachable",
        `No Ollama server at ${baseUrl} / 未连接到本地 Ollama`,
      );
    }
    if (!response.ok) {
      let detail = "";
      try {
        detail = String((await response.json())?.error ?? "");
      } catch {}
      throw new LocalModelError(
        "local_model_failed",
        `Ollama HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      );
    }
    return response.json();
  }
  async function capabilities(model) {
    try {
      const shown = await call(
        "/api/show",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model }),
        },
        5_000,
      );
      return Array.isArray(shown?.capabilities) ? shown.capabilities : [];
    } catch {
      return [];
    }
  }
  return Object.freeze({
    baseUrl,
    async listModels() {
      const tags = await call("/api/tags", {}, 5_000);
      const models = [];
      for (const entry of tags?.models ?? []) {
        if (typeof entry?.name !== "string" || !entry.name) continue;
        // Older servers leave capabilities out of the listing; ask for them separately.
        const listed = Array.isArray(entry.capabilities)
          ? entry.capabilities
          : await capabilities(entry.name);
        models.push({ name: entry.name, size: Number(entry.size) || 0, capabilities: listed });
      }
      return models;
    },
    // An empty conversation only loads the model, with the context window searches use,
    // so a later search does not pay for the load.
    async warm({ model, numCtx = 16_384 }) {
      return call("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [], options: { num_ctx: numCtx } }),
      });
    },
    async chat({ model, messages, tools, numCtx = 16_384, numPredict = 4_096 }) {
      // Ollama's own default window is 2k tokens and it silently drops the start of a
      // longer prompt, which is where the instructions and the resume sit.
      return call("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          think: false,
          ...(tools?.length ? { tools } : {}),
          options: { temperature: 0, seed: 7, num_ctx: numCtx, num_predict: numPredict },
        }),
      });
    },
  });
}

// The configured model wins. Otherwise the smallest installed model that can call tools:
// the most likely to fit in GPU memory, and the fastest per step.
export function pickToolModel(models, requested = process.env.CAREER_RADAR_OLLAMA_MODEL) {
  const wanted = String(requested ?? "").trim();
  if (wanted) {
    const name = wanted.includes(":") ? wanted : `${wanted}:latest`;
    const found = models.find((model) => model.name === wanted || model.name === name);
    if (!found)
      return {
        model: null,
        reason: `Model ${wanted} is not installed in Ollama / 本地未安装该模型`,
      };
    if (!found.capabilities.includes("tools"))
      return {
        model: null,
        reason: `Model ${found.name} does not support tool calling / 该模型不支持工具调用`,
      };
    return { model: found.name, reason: null };
  }
  const capable = models
    .filter((model) => model.capabilities.includes("tools"))
    .sort((left, right) => left.size - right.size);
  if (!capable.length)
    return {
      model: null,
      reason: "No installed model supports tool calling / 没有支持工具调用的本地模型",
    };
  return { model: capable[0].name, reason: null };
}

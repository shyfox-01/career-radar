import { runSearchBatches } from "./search-runner.js";
import { waitForReadableSource } from "./login-resume.js";
const WORKSPACE_ID = "default";
const API = `/api/workspaces/${WORKSPACE_ID}`;
const STATUSES = ["new", "viewed", "saved", "applied", "interview", "offer", "rejected"];
const STATUS_LABELS = {
  new: "新职位",
  viewed: "已查看",
  saved: "已收藏",
  applied: "已投递",
  interview: "面试中",
  offer: "已获 Offer",
  rejected: "未通过",
};
// The same wording as the Excel export (src/domain/xlsx.js); unknown codes show as is.
const NOTE_LABELS = {
  title_role_evidence: "Job title matches the role / 职位名称与岗位相符",
  description_skill_evidence: "Description names the role's skills / 职位描述提到相关技能",
  adjacent_role_evidence: "Related role / 相关岗位",
  limited_role_evidence: "Little direct evidence / 直接依据较少",
  source_company_normalized: "Company name tidied from the site's text / 公司名已按网站原文整理",
  source_company_unresolved: "The site gives no usable company name / 网站未给出可用的公司名",
};
const noteLabel = (code) => NOTE_LABELS[code] ?? code;
let workspace = { profile: {}, searchPlan: [], jobs: [] };
let sourceCatalog = [];
let sourceConnections = [];
let localModelStatus = null;
let scanRunning = false;
let scanPollBusy = false;
let scanPauseRequested = false;

function renderScanProgress() {
  const scan = workspace.scanProgress;
  if (!scan) return;
  const reasons = {
    running: "Reading / 正在读取",
    last_page: "Last page reached / 已到末页",
    page_limit: "Batch limit; continue available / 达到本批上限，可继续",
    cancelled: "Paused / 已暂停",
    pagination_unavailable: "Next page not confirmed / 下一页尚未确认",
    page_incomplete: "Page not fully loaded / 本页未加载完整",
    pagination_loop: "Repeated page / 页面重复",
    sign_in_required: "Login required / 需要登录",
    challenge_required: "Security check required / 需要安全验证",
    provider_results_unverified: "Screened by the local model / 本地模型已筛选",
    provider_search_failed: "Local model unavailable / 本地模型不可用",
    local_model_failed: "Local model error / 本地模型出错",
    source_api_unreachable: "Site unreachable / 网站无法连接",
    source_api_failed: "Site search failed / 网站搜索失败",
  };
  byId("scan-progress").textContent =
    `${scan.sourceId ?? ""}: ${scan.pagesRead ?? 0} pages / 页 · ${scan.uniqueJobs ?? 0} jobs / 条 · ${reasons[scan.stopReason] ?? scan.stopReason}`;
}

const byId = (id) => document.getElementById(id);

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const type = response.headers.get("content-type") ?? "";
  const body = type.includes("json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body.error ?? `请求失败（${response.status}）`);
  return body;
}

function toast(message, error = false) {
  const element = byId("toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.remove("show"), 3200);
}

function selected(form, name) {
  return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((input) => input.value);
}

function renderMetrics() {
  byId("metric-plan").textContent = workspace.searchPlan?.length ?? 0;
  byId("metric-jobs").textContent = workspace.jobs?.length ?? 0;
  byId("metric-applied").textContent = (workspace.jobs ?? []).filter((job) =>
    ["applied", "interview", "offer"].includes(job.status),
  ).length;
  byId("metric-verified").textContent = (workspace.jobs ?? []).filter(
    (job) => job.verification === "source_checked",
  ).length;
}

function renderIncrementalState() {
  const imports = workspace.importHistory ?? [];
  const latestImport = imports.at(-1);
  const scanTime = workspace.lastDiscoveryAt
    ? new Date(workspace.lastDiscoveryAt).toLocaleString("zh-CN")
    : null;
  const parts = [];
  if (latestImport)
    parts.push(
      `${latestImport.filename}：接收 ${latestImport.accepted ?? 0}、规范化 ${latestImport.normalized ?? 0}、合并 ${latestImport.merged ?? 0}、隔离 ${latestImport.quarantined ?? 0}`,
    );
  if (scanTime) parts.push(`从 ${scanTime} 附近继续，并回看 48 小时`);
  byId("incremental-state").textContent = parts.length
    ? parts.join(" · ")
    : `Local history auto-saved / 本机记录已自动保存 · 当前 ${workspace.jobs?.length ?? 0} 条`;
  byId("import-audit-link").hidden = !workspace.latestImportAudit;
}

function renderResume() {
  const resume = workspace.resume;
  byId("resume-state").textContent = resume
    ? `${resume.originalFilename} · 已隐藏 ${resume.redactionFindings.length} 处信息`
    : "尚未上传";
  byId("resume-preview").textContent = resume?.redactedPreview ?? "尚未导入任何内容。";
}

function joinValues(values) {
  return Array.isArray(values) ? values.join(", ") : "";
}

function splitValues(value) {
  return [
    ...new Set(
      String(value ?? "")
        .split(/[,，;；\n]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function renderPreferences() {
  const form = byId("preferences-form");
  const preferences = workspace.preferences ?? {};
  for (const name of ["graduationDate", "internshipAvailableFrom", "careerNote"]) {
    form.elements[name].value = preferences[name] ?? "";
  }
  for (const name of ["industries", "roleInterests", "emphasizedSkills", "excludedWork"]) {
    form.elements[name].value = joinValues(preferences[name]);
  }
  const meaningful = Object.entries(preferences).some(([, value]) =>
    Array.isArray(value) ? value.length : Boolean(value),
  );
  byId("preferences-state").textContent = meaningful
    ? "Saved locally / 已在本地保存"
    : "Optional / 可选补充";
}

function renderRoleSuggestions() {
  const container = byId("role-suggestions");
  const suggestions = workspace.roleSuggestions ?? [];
  const approved = new Set(
    (workspace.approvedRoles ?? []).map((title) => title.toLocaleLowerCase("en")),
  );
  container.replaceChildren();
  container.classList.toggle("empty-state", suggestions.length === 0);
  if (!suggestions.length) {
    container.textContent = "上传简历或填写补充资料后，点击“生成岗位建议”。";
  } else {
    for (const role of suggestions) {
      const label = document.createElement("label");
      label.className = "role-card";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "suggestedRoles";
      checkbox.value = role.title;
      checkbox.checked = role.selected || approved.has(role.title.toLocaleLowerCase("en"));
      const content = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = role.title;
      const score = document.createElement("b");
      score.className = "role-score";
      score.textContent = `FIT ${role.score}`;
      const evidence = document.createElement("small");
      evidence.textContent = role.evidence.join(" · ");
      content.append(title, score, evidence);
      label.append(checkbox, content);
      container.append(label);
    }
  }
  byId("approved-roles-state").textContent = workspace.approvedRoles?.length
    ? `已确认 ${workspace.approvedRoles.length} 个岗位：${workspace.approvedRoles.join("、")}`
    : "尚未确认岗位；搜索只会使用你明确确认的名称。";
}

function renderSourceCatalog() {
  const container = byId("source-catalog");
  if (!sourceCatalog.length) return;
  const saved = workspace.profile?.selectedSourceIds;
  const selectedIds = new Set(
    Array.isArray(saved)
      ? saved
      : sourceCatalog.filter((source) => source.defaultEnabled).map((source) => source.id),
  );
  container.replaceChildren();
  container.classList.remove("empty-state");
  for (const market of ["SG", "CN", "HK"]) {
    const group = document.createElement("section");
    group.className = "source-group";
    const heading = document.createElement("h4");
    heading.textContent =
      market === "SG" ? "Singapore" : market === "CN" ? "Mainland China / 中国大陆" : "Hong Kong";
    group.append(heading);
    for (const source of sourceCatalog.filter((item) => item.market === market)) {
      const label = document.createElement("label");
      label.className = "source-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.name = "sources";
      checkbox.value = source.id;
      checkbox.checked = selectedIds.has(source.id);
      const content = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = source.name;
      const meta = document.createElement("small");
      const support =
        source.listingSupport === "tested"
          ? "Reader tested / 读取已实测"
          : source.listingSupport === "experimental"
            ? "Experimental reader / 实验性读取"
            : localModelStatus?.capabilities?.sourceIds?.includes(source.id)
              ? "Local model / 本地模型"
              : "Search link / 搜索链接";
      meta.textContent = support;
      if (source.readingEvidence) meta.title = source.readingEvidence;
      content.append(name, meta);
      if (source.defaultEnabled) {
        const badge = document.createElement("b");
        badge.textContent = "DEFAULT";
        content.append(badge);
      }
      label.append(checkbox, content);
      group.append(label);
      if (source.access === "login" || source.adapterId)
        group.append(createSourceConnection(source));
    }
    container.append(group);
  }
}

function sourceConnectionLabel(state) {
  return (
    {
      not_connected: "Not connected / 未连接",
      connected_unverified: "Connecting automatically / 正在自动连接",
      connected: "Connected / 已连接",
      expired: "Expired / 登录已失效",
      needs_repair: "Needs repair / 需要修复",
      desktop_required: "Desktop app required / 需桌面版",
    }[state] ?? "Unknown / 未知"
  );
}

function actionButton(text, handler, className = "button secondary compact") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = text;
  button.addEventListener("click", handler);
  return button;
}

function createSourceConnection(source) {
  const connection = sourceConnections.find((item) => item.sourceId === source.id) ?? {
    state: "not_connected",
  };
  const box = document.createElement("div");
  box.className = "source-connection";
  box.dataset.sourceId = source.id;
  const state = document.createElement("span");
  state.className = `connection-state ${connection.state}`;
  state.textContent =
    connection.extraction === "ready"
      ? connection.authentication === "signed_in"
        ? "Connected · Reading ready / 已连接 · 可读取"
        : "Reading ready / 当前可读取"
      : connection.authentication === "signed_in"
        ? "Signed in · Reading pending / 已登录 · 读取待验证"
        : sourceConnectionLabel(connection.state);
  if (connection.authentication === "signed_out")
    state.textContent = "Sign in in the source window / 请在来源窗口登录";
  else if (connection.authentication === "challenge")
    state.textContent = "Complete the website security check / 请完成网站安全验证";
  else if (connection.lastFailure && connection.extraction !== "ready")
    state.textContent = "Reading needs attention / 读取需要处理";
  const actions = document.createElement("div");
  actions.className = "connection-actions";
  if (["not_connected", "expired", "needs_repair"].includes(connection.state)) {
    actions.append(actionButton("Connect / 登录连接", () => connectSource(source.id)));
  } else if (connection.state === "connected_unverified") {
    if (source.adapterId && connection.lastFailure) {
      actions.append(actionButton("Retry Connection / 重试连接", () => probeSource(source.id)));
    }
    actions.append(actionButton("Open / 打开", () => openConnectedSource(source)));
    actions.append(actionButton("Disconnect / 断开", () => disconnectSource(source.id)));
  } else if (connection.state === "connected") {
    actions.append(
      actionButton("Open / 打开", () => openConnectedSource(source), "button primary compact"),
    );
    actions.append(actionButton("Disconnect / 断开", () => disconnectSource(source.id)));
  }
  box.append(state, actions);
  if (connection.scan) {
    const progress = document.createElement("small");
    progress.textContent = `Search: ${connection.scan.pagesRead} pages · ${connection.scan.uniqueJobs} jobs · ${connection.scan.stopReason} / 正式搜索：${connection.scan.pagesRead} 页，${connection.scan.uniqueJobs} 条，${connection.scan.complete ? "已到末页" : "尚未扫描完"}`;
    box.append(progress);
  }
  if (connection.lastFailure?.message) {
    const failure = document.createElement("small");
    failure.textContent = connection.lastFailure.message;
    box.append(failure);
  }
  return box;
}

async function loadSourceConnections(connectionOnly = false) {
  sourceConnections = await request("/api/source-connections");
  if (!connectionOnly) renderSourceCatalog();
  else {
    // Preserve unsaved source selections while updating connection badges.
    for (const box of document.querySelectorAll(".source-connection")) {
      const source = sourceCatalog.find((item) => item.id === box.dataset.sourceId);
      if (source) box.replaceWith(createSourceConnection(source));
    }
  }
}

async function connectSource(sourceId) {
  try {
    await request(`/api/source-connections/${encodeURIComponent(sourceId)}/connect`, {
      method: "POST",
    });
    await loadSourceConnections();
    toast(
      "Sign in in the opened window; supported sources connect automatically. / 在弹出的窗口登录即可，已接入的来源会自动连接，无需再点击验证。",
    );
  } catch (error) {
    toast(`无法打开登录窗口：${error.message}`, true);
  }
}

async function confirmSource(sourceId) {
  try {
    await request(`/api/source-connections/${encodeURIComponent(sourceId)}/confirm`, {
      method: "POST",
    });
    await loadSourceConnections();
    toast("登录状态已由你确认；程序不会读取或导出登录凭据。");
  } catch (error) {
    toast(`确认失败：${error.message}`, true);
  }
}

async function probeSource(sourceId) {
  try {
    const result = await request(`/api/source-connections/${encodeURIComponent(sourceId)}/probe`, {
      method: "POST",
    });
    await loadSourceConnections();
    if (
      ["signed_in", "not_required"].includes(result.authentication) &&
      result.extraction === "ready"
    ) {
      toast(
        `Reading test passed (${result.probeResultCount ?? 0} sample cards). Find / Continue Jobs scans further pages. / 读取测试通过（样本 ${result.probeResultCount ?? 0} 条）；点击搜索 / 继续才开始正式翻页搜索。`,
      );
    } else if (result.authentication === "signed_in") {
      toast(
        "Signed in; job reading is not ready yet. Keep the job results window open and re-check. / 已登录，职位读取尚未就绪；请保持职位结果窗口打开后重新验证。",
      );
    } else {
      toast(
        "Verification needs attention. Open the source window and complete login or security checks / 验证未通过，请在来源窗口完成登录或安全验证。",
        true,
      );
    }
  } catch (error) {
    toast(`验证失败 / Verification failed: ${error.message}`, true);
  }
}

async function openConnectedSource(source) {
  try {
    await request(`/api/source-connections/${encodeURIComponent(source.id)}/open`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: source.exampleUrl }),
    });
    await loadSourceConnections();
  } catch (error) {
    toast(`打开失败：${error.message}`, true);
  }
}

async function disconnectSource(sourceId) {
  if (!window.confirm("断开后会清除这个招聘渠道在 Career Radar 中保存的登录会话，是否继续？"))
    return;
  try {
    await request(`/api/source-connections/${encodeURIComponent(sourceId)}`, { method: "DELETE" });
    await loadSourceConnections();
    toast("该渠道的独立登录会话已清除。");
  } catch (error) {
    toast(`断开失败：${error.message}`, true);
  }
}

function sourceNames(ids) {
  return ids.map((id) => sourceCatalog.find((source) => source.id === id)?.name ?? id);
}

function modelStateLabel(state) {
  return (
    {
      missing: "NOT RUNNING / 未运行",
      incompatible: "NO TOOL MODEL / 缺少可用模型",
      ready: "READY / 可用",
    }[state] ?? "UNKNOWN / 未知"
  );
}

function renderLocalModel() {
  const model = localModelStatus;
  if (!model) return;
  const container = byId("provider-list");
  container.replaceChildren();
  container.classList.remove("empty-state");
  const card = document.createElement("article");
  card.className = `provider-card${model.state === "ready" ? " active" : ""}`;
  const head = document.createElement("div");
  head.className = "provider-card-head";
  const title = document.createElement("h3");
  title.textContent = model.name;
  const state = document.createElement("span");
  state.className = "provider-state";
  state.textContent = modelStateLabel(model.state);
  head.append(title, state);
  const capabilities = document.createElement("p");
  capabilities.className = "provider-capabilities";
  capabilities.textContent = `Runs on this computer, no usage fees / 本机运行，不产生调用费用 · Searches / 可搜索：${sourceNames(model.capabilities?.sourceIds ?? []).join("、") || "—"}${model.model ? ` · ${model.model}` : ""}${model.detail ? ` · ${model.detail}` : ""}`;
  const actions = document.createElement("div");
  actions.className = "provider-actions";
  const guide = document.createElement("a");
  guide.href = "https://docs.ollama.com/";
  guide.target = "_blank";
  guide.rel = "noopener noreferrer";
  guide.textContent = "Setup Guide / 安装指引";
  actions.append(guide);
  card.append(head, capabilities, actions);
  container.append(card);
  const pill = byId("account-pill");
  pill.classList.toggle("ready", model.state === "ready");
  pill.lastElementChild.textContent =
    model.state === "ready"
      ? `AI: 本地模型 · ${model.model}`
      : `AI: 本地模型 · ${modelStateLabel(model.state)}`;
}

function renderQueue() {
  const queue = workspace.searchQueue;
  const adapterFailures = workspace.lastSourceAdapterRun?.failedTasks ?? [];
  const summary = queue
    ? `本批执行 ${queue.executeIds.length} 条 · 下批待处理 ${queue.queuedIds.length} 条 · 每批上限 ${queue.limit}`
    : "尚未生成队列 · 每次最多执行 40 条搜索组合";
  byId("queue-state").textContent = adapterFailures.length
    ? `${summary} · ${adapterFailures.length} adapter task(s) need attention / 个适配器任务需处理`
    : summary;
}

// A search that found nothing must say why: a missing desktop reader and a failed AI
// call are different problems with different fixes.
function renderSearchDiagnostics() {
  const box = byId("search-diagnostics");
  const run = workspace.lastSourceAdapterRun;
  const lines = [];
  const unsupported = run?.unsupportedTaskIds ?? [];
  if (unsupported.length) {
    const names = [
      ...new Set(
        unsupported.map(
          (id) =>
            sourceCatalog.find((source) => source.id === id.split(":")[1])?.name ??
            id.split(":")[1],
        ),
      ),
    ];
    lines.push(
      `${unsupported.length} task(s) need the desktop app to read ${names.join("、")} / ${unsupported.length} 个任务需要桌面版才能读取：${names.join("、")}`,
    );
  }
  if (run?.providerFailure) {
    lines.push(`AI search unavailable / AI 搜索不可用：${run.providerFailure.message}`);
  }
  // Tasks already reported as needing the desktop app are not listed a second time.
  const notSearched = (run?.providerUnsupportedTaskIds ?? []).filter(
    (id) => !unsupported.includes(id),
  );
  if (notSearched.length) {
    const names = [...new Set(sourceNames(notSearched.map((id) => id.split(":")[1])))];
    lines.push(
      `${notSearched.length} task(s) not searched; the local model has no tool for ${names.join("、")} / ${notSearched.length} 个任务未搜索，本地模型没有以下来源的工具：${names.join("、")}`,
    );
  }
  const failedSearches = run?.providerFailedTasks ?? [];
  if (failedSearches.length) {
    lines.push(
      `${failedSearches.length} AI task(s) failed / 个 AI 任务失败：${[...new Set(failedSearches.map((failure) => failure.message))].join("；")}`,
    );
  }
  const blockedSources = workspace.searchContinuation?.blockedSourceIds ?? [];
  if (blockedSources.length) {
    const names = blockedSources.map(
      (id) => sourceCatalog.find((source) => source.id === id)?.name ?? id,
    );
    lines.push(
      `Paused until you sign in or clear a check on / 以下渠道需登录或通过验证后才会继续：${names.join("、")}`,
    );
  }
  box.textContent = lines.join(" · ");
  box.hidden = lines.length === 0;
}

function renderCompanies() {
  const container = byId("company-list");
  const companies = workspace.companyWatchlist ?? [];
  container.replaceChildren();
  container.classList.toggle("empty-state", companies.length === 0);
  if (!companies.length) {
    container.textContent = "尚未添加企业官网。";
    return;
  }
  for (const company of companies) {
    const card = document.createElement("article");
    card.className = "company-card";
    const detail = document.createElement("div");
    const link = document.createElement(company.careersUrl ? "a" : "strong");
    link.textContent = company.name;
    if (company.careersUrl) {
      link.href = company.careersUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
    const domain = document.createElement("small");
    domain.textContent = `${company.domain ?? "招聘官网待补充"} · ${company.markets.join(" / ")}`;
    detail.append(link, domain);
    const meta = document.createElement("span");
    meta.className = "company-meta";
    meta.textContent = `${company.atsFamily === "unresolved" ? "官网待确认" : company.atsFamily} · 未核验`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "移除";
    remove.addEventListener("click", () => removeCompany(company.id));
    card.append(detail, meta, remove);
    container.append(card);
  }
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function renderPlan() {
  const container = byId("search-plan");
  container.replaceChildren();
  const plan = workspace.searchPlan ?? [];
  container.classList.toggle("empty-state", plan.length === 0);
  if (!plan.length) {
    container.textContent = "请先选择地区、岗位方向和工作类型，然后生成搜索路线。";
    return;
  }
  for (const entry of plan) {
    const card = document.createElement("article");
    card.className = "route-card";
    const market = document.createElement("span");
    market.className = "market";
    market.textContent = entry.market;
    const provider = document.createElement("span");
    provider.className = "provider";
    provider.textContent = entry.provider;
    const query = document.createElement("span");
    query.className = "query";
    query.textContent = entry.query;
    const link = document.createElement("a");
    link.textContent = "打开招聘来源 ↗";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const href = safeExternalUrl(entry.searchUrl);
    if (href) link.href = href;
    else link.removeAttribute("href");
    card.append(market, provider, query, link);
    container.append(card);
  }
}

function renderJobs() {
  const body = byId("jobs-body");
  body.replaceChildren();
  const jobs = workspace.jobs ?? [];
  const needsReview = jobs.filter((job) => job.reviewStatus === "needs_review");
  const recommended = jobs.filter((job) => job.reviewStatus !== "needs_review");
  const showNeedsReview = byId("show-needs-review").checked;
  const fitOrder = { strong: 0, adjacent: 1, broad: 2 };
  const visibleJobs = (showNeedsReview ? jobs : recommended).toSorted(
    (a, b) => (fitOrder[a.fitLevel] ?? 9) - (fitOrder[b.fitLevel] ?? 9),
  );
  const count = (level) => recommended.filter((job) => job.fitLevel === level).length;
  const dataNotes = recommended.filter((job) => (job.dataWarnings ?? []).length).length;
  byId("job-quality-summary").textContent =
    `Strong ${count("strong")} / 强匹配 ${count("strong")} · Adjacent ${count("adjacent")} / 相邻 ${count("adjacent")} · Broad ${count("broad")} / 宽泛 ${count("broad")} · Data notes ${dataNotes} / 数据提示 ${dataNotes} · Needs review ${needsReview.length} / 待复核 ${needsReview.length}`;
  if (!jobs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "暂时没有岗位。你可以手动添加，或运行搜索。";
    body.append(empty);
    return;
  }
  if (!visibleJobs.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent =
      "No recommended jobs yet. Turn on ‘Show needs review’ to inspect quarantined records. / 暂无推荐岗位，可勾选“显示待复核”检查隔离记录。";
    body.append(empty);
    return;
  }
  for (const job of visibleJobs) {
    const row = document.createElement("article");
    row.className = `job-ledger-row${job.reviewStatus === "needs_review" ? " needs-review-row" : ""}`;
    const top = document.createElement("div");
    top.className = "job-ledger-top";
    const identity = document.createElement("div");
    identity.className = "job-identity";
    const title = document.createElement(job.url ? "a" : "span");
    title.className = job.url ? "job-title job-link" : "job-title";
    title.textContent = job.title;
    const href = safeExternalUrl(job.url);
    if (title.tagName === "A" && href) {
      title.href = href;
      title.target = "_blank";
      title.rel = "noopener noreferrer";
    }
    const company = document.createElement("div");
    company.className = "job-company";
    company.textContent = job.company || "Company to confirm / 公司待确认";
    identity.append(title, company);
    const statusBlock = document.createElement("label");
    statusBlock.className = "job-status-block";
    const statusLabel = document.createElement("span");
    statusLabel.textContent = "STATUS / 状态";
    const select = document.createElement("select");
    select.className = "status-select";
    select.setAttribute("aria-label", `${job.title} 的投递状态`);
    for (const status of STATUSES) {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = STATUS_LABELS[status];
      option.selected = (job.status ?? "new") === status;
      select.append(option);
    }
    select.addEventListener("change", () => updateStatus(job.id, select.value));
    statusBlock.append(statusLabel, select);
    top.append(identity, statusBlock);

    const meta = document.createElement("div");
    meta.className = "job-meta";
    const location = document.createElement("span");
    location.className = "job-meta-chip";
    location.textContent = job.location ?? "Location unknown / 地点待确认";
    const source = document.createElement("span");
    source.className = "job-meta-chip";
    source.textContent = job.source ?? job.sources?.join(", ") ?? "Manual / 手动添加";
    const fit = document.createElement("span");
    fit.className = `fit-badge fit-${job.fitLevel ?? "broad"}`;
    const fitLabels = {
      strong: "Strong fit / 强匹配",
      adjacent: "Adjacent fit / 相邻匹配",
      broad: "Broad fit / 宽泛匹配",
    };
    fit.textContent = fitLabels[job.fitLevel] ?? "Fit unclassified / 匹配未分类";
    fit.title = (job.fitReasons ?? []).map(noteLabel).join(", ");
    meta.append(location, source, fit);

    const details = document.createElement("details");
    details.className = "job-details";
    const summary = document.createElement("summary");
    summary.textContent = "Details / 详情";
    const detailBody = document.createElement("div");
    detailBody.className = "job-detail-body";
    const badge = document.createElement("span");
    badge.className = "verification";
    badge.textContent =
      job.verification === "source_checked"
        ? "Source checked / 来源已核验"
        : "Source pending / 来源待核验";
    detailBody.append(badge);
    if ((job.fitReasons ?? []).length) {
      const reason = document.createElement("p");
      reason.innerHTML = `<strong>Fit evidence / 匹配依据</strong><span></span>`;
      reason.querySelector("span").textContent = job.fitReasons.map(noteLabel).join(" · ");
      detailBody.append(reason);
    }
    // Notes the AI wrote when it chose this listing; every field above came from the source.
    for (const [label, items, className] of [
      ["AI: why it fits / AI 匹配理由", job.matchReasons, "ai-note"],
      ["AI: gaps to check / AI 欠缺条件", job.missingRequirements, "ai-note ai-gaps"],
    ]) {
      if (!items?.length) continue;
      const note = document.createElement("p");
      note.className = className;
      const heading = document.createElement("strong");
      heading.textContent = label;
      note.append(heading);
      for (const item of items) {
        const line = document.createElement("span");
        line.textContent = `· ${item}`;
        note.append(line);
      }
      detailBody.append(note);
    }
    if ((job.dataWarnings ?? []).length) {
      const warning = document.createElement("p");
      warning.className = "data-warning";
      warning.innerHTML = "<strong>Data note / 数据提示</strong><span></span>";
      warning.querySelector("span").textContent = job.dataWarnings.map(noteLabel).join(" · ");
      warning.title =
        job.rawCompany && job.rawCompany !== job.company ? `Raw company: ${job.rawCompany}` : "";
      detailBody.append(warning);
    }
    if (job.reviewStatus === "needs_review") {
      const review = document.createElement("p");
      review.className = "review-badge";
      review.innerHTML = "<strong>Needs review / 待复核</strong><span></span>";
      review.querySelector("span").textContent =
        (job.reviewReasons ?? []).join(" · ") || "quality_gate";
      detailBody.append(review);
    }
    const timeline = document.createElement("span");
    timeline.className = `timeline-status ${job.timeline?.status ?? "date_unknown"}`;
    timeline.textContent =
      job.timeline?.status === "advisory"
        ? "Start date to confirm / 开始时间需确认"
        : job.timeline?.status === "eligible"
          ? "Start date eligible / 开始日期可行"
          : "Date not stated / 日期未写明";
    timeline.title = job.timeline?.reasons?.join(" · ") ?? "职位未提供足够日期信息";
    detailBody.append(timeline);
    if (job.timeline?.durationLabel) {
      const duration = document.createElement("small");
      duration.className = "duration-label";
      duration.textContent = `Duration / 实习时长：${job.timeline.durationLabel}`;
      detailBody.append(duration);
    }
    details.append(summary, detailBody);
    row.append(top, meta, details);
    body.append(row);
  }
}

function render() {
  renderMetrics();
  renderIncrementalState();
  renderLocalModel();
  renderResume();
  renderPreferences();
  renderRoleSuggestions();
  renderSourceCatalog();
  renderQueue();
  renderCompanies();
  renderPlan();
  renderJobs();
  renderScanProgress();
  renderSearchDiagnostics();
}

byId("show-needs-review").addEventListener("change", renderJobs);

async function refresh() {
  workspace = await request(API);
  render();
}

async function importResume(filename, bytes) {
  const resume = await request(`${API}/resume`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", "x-filename": filename },
    body: bytes,
  });
  workspace.resume = resume;
  renderResume();
  toast("脱敏预览已生成，请展开检查后再搜索。");
}

byId("resume-file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    await importResume(file.name, await file.arrayBuffer());
  } catch (error) {
    toast(error.message, true);
  }
});

const dropZone = byId("drop-zone");
for (const name of ["dragenter", "dragover"])
  dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
for (const name of ["dragleave", "drop"])
  dropZone.addEventListener(name, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
dropZone.addEventListener("drop", async (event) => {
  const file = event.dataTransfer.files[0];
  if (!file) return;
  try {
    await importResume(file.name, await file.arrayBuffer());
  } catch (error) {
    toast(error.message, true);
  }
});

byId("paste-resume").addEventListener("click", async () => {
  const text = byId("resume-text").value.trim();
  if (!text) return toast("请先粘贴简历文字。", true);
  try {
    await importResume("pasted-resume.txt", new TextEncoder().encode(text));
  } catch (error) {
    toast(error.message, true);
  }
});

byId("preferences-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const preferences = {
    graduationDate: values.graduationDate,
    internshipAvailableFrom: values.internshipAvailableFrom,
    industries: splitValues(values.industries),
    roleInterests: splitValues(values.roleInterests),
    emphasizedSkills: splitValues(values.emphasizedSkills),
    excludedWork: splitValues(values.excludedWork),
    careerNote: values.careerNote,
  };
  try {
    workspace = await request(`${API}/preferences`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(preferences),
    });
    renderPreferences();
    toast("补充资料已保存在本机，不会改写简历。下一步可据此生成岗位方向。");
  } catch (error) {
    toast(`保存失败：${error.message}`, true);
  }
});

byId("suggest-roles").addEventListener("click", async (event) => {
  if (!workspace.resume?.redactedPreview && !Object.keys(workspace.preferences ?? {}).length) {
    return toast("请先上传简历，或至少保存一项求职补充资料。", true);
  }
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "正在生成…";
  try {
    workspace = await request(`${API}/role-suggestions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    renderRoleSuggestions();
    toast(`已生成 ${workspace.roleSuggestions.length} 个有依据的岗位建议，请勾选确认。`);
  } catch (error) {
    toast(`生成失败：${error.message}`, true);
  } finally {
    button.disabled = false;
    button.textContent = "Suggest Roles / 生成岗位建议";
  }
});

byId("approve-roles").addEventListener("click", async () => {
  const checked = [...document.querySelectorAll('input[name="suggestedRoles"]:checked')].map(
    (input) => input.value,
  );
  const custom = splitValues(byId("custom-roles").value);
  const titles = [...checked, ...custom];
  if (!titles.length) return toast("请至少勾选或手动填写一个岗位名称。", true);
  try {
    workspace = await request(`${API}/approved-roles`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ titles }),
    });
    renderRoleSuggestions();
    toast(`已确认 ${workspace.approvedRoles.length} 个岗位，搜索路线只使用这些名称。`);
  } catch (error) {
    toast(`确认失败：${error.message}`, true);
  }
});

byId("criteria-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const markets = selected(form, "markets");
  const selectedSourceIds = [...document.querySelectorAll('input[name="sources"]:checked')]
    .map((input) => input.value)
    .filter((id) => markets.includes(sourceCatalog.find((source) => source.id === id)?.market));
  const criteria = {
    markets,
    roleTitles: workspace.approvedRoles ?? [],
    employmentTypes: selected(form, "employment"),
    selectedSourceIds,
  };
  if (!criteria.markets.length || !criteria.roleTitles.length || !criteria.employmentTypes.length)
    return toast("地区、已确认岗位和工作类型都至少需要一项。", true);
  if (
    criteria.markets.some(
      (market) =>
        !selectedSourceIds.some(
          (id) => sourceCatalog.find((source) => source.id === id)?.market === market,
        ),
    )
  )
    return toast("每个目标地区至少勾选一个招聘来源。", true);
  try {
    workspace = await request(`${API}/search-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(criteria),
    });
    render();
    toast(`已生成 ${workspace.searchPlan.length} 条可追溯的搜索路线。`);
  } catch (error) {
    toast(`生成失败：${error.message}`, true);
  }
});

byId("company-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const markets = selected(form, "companyMarkets");
  if (!markets.length) return toast("企业官网至少选择一个适用地区。", true);
  try {
    workspace = await request(`${API}/companies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: values.name, careersUrl: values.careersUrl, markets }),
    });
    form.reset();
    form.elements.companyMarkets[0].checked = true;
    renderCompanies();
    toast("企业已加入本机清单；招聘官网仍保持未核验标记。");
  } catch (error) {
    toast(`添加失败：${error.message}`, true);
  }
});

async function removeCompany(companyId) {
  try {
    workspace = await request(`${API}/companies/${encodeURIComponent(companyId)}`, {
      method: "DELETE",
    });
    renderCompanies();
    toast("企业已从清单移除。");
  } catch (error) {
    toast(`移除失败：${error.message}`, true);
  }
}

byId("refresh-providers").addEventListener("click", async () => {
  try {
    await loadLocalModel();
    toast("本地模型状态已重新检测。");
  } catch (error) {
    toast(`检测失败：${error.message}`, true);
  }
});

byId("manual-job-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  try {
    workspace = await request(`${API}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobs: [{ ...values, source: "手动添加" }] }),
    });
    form.reset();
    render();
    toast("岗位已加入列表。");
  } catch (error) {
    toast(`添加失败：${error.message}`, true);
  }
});

byId("jobs-csv-file").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const file = input.files[0];
  if (!file) return;
  try {
    const result = await request(`${API}/import.csv`, {
      method: "POST",
      headers: { "content-type": "text/csv", "x-filename": file.name },
      body: await file.arrayBuffer(),
    });
    workspace = result.workspace;
    render();
    toast(
      `导入完成：接收 ${result.summary.accepted}、规范化 ${result.summary.normalized}、合并 ${result.summary.merged}、隔离 ${result.summary.quarantined}；新增 ${result.summary.added} 条。`,
    );
  } catch (error) {
    toast(`导入失败：${error.message}`, true);
  } finally {
    input.value = "";
  }
});

async function updateStatus(jobId, status) {
  try {
    workspace = await request(`${API}/jobs/${encodeURIComponent(jobId)}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    renderMetrics();
    toast(`投递状态已更新为“${STATUS_LABELS[status]}”。`);
  } catch (error) {
    toast(`状态更新失败：${error.message}`, true);
    await refresh();
  }
}

byId("cancel-search").addEventListener("click", async () => {
  scanPauseRequested = true;
  await request(`${API}/cancel-search`, { method: "POST" });
  toast("Pausing after the current operation; saved jobs are retained / 正在暂停，已读职位会保留");
});

byId("discover").addEventListener("click", async (event) => {
  if (!workspace.resume?.redactedPreview || !workspace.searchPlan?.length)
    return toast("请先上传简历并生成搜索路线。", true);
  if (
    !window.confirm(
      "Search selected sites using their login sessions. Sites without a reader go to the local model on this computer; nothing is sent to a cloud AI. No applications will be submitted. / 使用所选网站会话搜索；没有读取器的网站交给本机模型处理，不会发送给任何云端 AI。不会自动投递。",
    )
  )
    return;
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "正在搜索新增职位…";
  scanRunning = true;
  scanPauseRequested = false;
  byId("cancel-search").hidden = false;
  const loginRetried = new Set();
  try {
    const run = await runSearchBatches({
      runBatch: ({ automatic, resumeSourceId }) =>
        request(
          `${API}/discover${automatic ? `?automatic=1${resumeSourceId ? `&resumeSource=${encodeURIComponent(resumeSourceId)}` : ""}` : ""}`,
          { method: "POST" },
        ),
      shouldStop: () => scanPauseRequested,
      waitForAccess: async (current) => {
        const blocked = new Set(current.searchContinuation?.blockedSourceIds ?? []);
        const ids = [
          ...new Set(
            (current.searchPlan ?? [])
              .filter(
                (task) =>
                  blocked.has(task.sourceId) &&
                  !loginRetried.has(task.sourceId) &&
                  ["sign_in_required", "challenge_required"].includes(
                    current.sourceCheckpoints?.[task.id]?.stopReason,
                  ),
              )
              .map((task) => task.sourceId),
          ),
        ];
        if (!ids.length) return false;
        const resumed = await waitForReadableSource({
          sourceIds: ids,
          shouldStop: () => scanPauseRequested,
          readConnections: (signal) => request("/api/source-connections", { signal }),
          openSource: (id, signal) =>
            request(`/api/source-connections/${encodeURIComponent(id)}/connect`, {
              method: "POST",
              signal,
            }),
          onWaiting: (id) => {
            const name = sourceCatalog.find((s) => s.id === id)?.name ?? id;
            button.textContent = `Waiting for ${name} login / 等待登录`;
            toast(
              `Complete login/security check in ${name}. Search resumes automatically after verification; waiting up to 2 minutes. / 请在 ${name} 窗口登录或验证，通过后自动续扫；本轮最多等待 2 分钟。`,
            );
          },
        });
        if (resumed) loginRetried.add(resumed);
        return resumed;
      },
      maxBatches: byId("auto-continue-search").checked ? 10 : 1,
      onBatch: async (current, batch) => {
        workspace = current;
        render();
        button.textContent = `Searching · batch ${batch} / 正在搜索 · 第 ${batch} 批`;
      },
    });
    if (run.workspace) workspace = run.workspace;
    render();
    const failures = workspace.lastSourceAdapterRun?.failedTasks?.length ?? 0;
    const pending = workspace.searchQueue?.total ?? 0;
    toast(
      failures || pending
        ? `Saved ${workspace.jobs.length} jobs; ${pending} tasks unfinished${run.limitReached ? " (session budget reached)" : ""} / 已保存 ${workspace.jobs.length} 条职位，${pending} 个任务未完成${run.limitReached ? "（已到本次批次上限）" : ""}。`
        : `This batch finished; saved ${workspace.jobs.length} deduplicated jobs. Check remaining queue / 本批已结束，保存 ${workspace.jobs.length} 条去重职位，请查看剩余队列。`,
      failures > 0,
    );
  } catch (error) {
    toast(`Search interrupted / 搜索中断：${error.message}`, true);
  } finally {
    scanRunning = false;
    byId("cancel-search").hidden = true;
    button.disabled = false;
    button.textContent = "Find / Continue Jobs · 搜索 / 继续";
    await refresh();
    renderScanProgress();
  }
});

setInterval(async () => {
  if (!scanRunning || scanPollBusy) return;
  scanPollBusy = true;
  try {
    const current = await request(API);
    workspace.jobs = current.jobs;
    workspace.scanProgress = current.scanProgress;
    renderJobs();
    renderMetrics();
    renderScanProgress();
    await loadSourceConnections(true);
  } catch {
  } finally {
    scanPollBusy = false;
  }
}, 2000);

async function loadSources() {
  sourceCatalog = await request("/api/sources");
  renderSourceCatalog();
}

async function loadLocalModel() {
  localModelStatus = await request("/api/local-model");
  renderLocalModel();
  // Source labels say which sites the local model can search.
  if (sourceCatalog.length) renderSourceCatalog();
}

Promise.all([loadLocalModel(), loadSources(), loadSourceConnections(), refresh()]).catch((error) =>
  toast(error.message, true),
);

let connectionRefreshBusy = false;
async function refreshConnectionBadges() {
  if (document.hidden || connectionRefreshBusy) return;
  connectionRefreshBusy = true;
  try {
    await loadSourceConnections(true);
  } catch {
    /* The next focus/poll retries local status. */
  } finally {
    connectionRefreshBusy = false;
  }
}
window.addEventListener("focus", refreshConnectionBadges);
setInterval(() => {
  if (sourceConnections.some((item) => item.adapterId && item.state === "connected_unverified")) {
    void refreshConnectionBadges();
  }
}, 2000);

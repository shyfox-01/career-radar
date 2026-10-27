import { PORTAL_PROFILES } from "./portal-profiles.js";
import { SourceAdapterError, validateCapability, validateSourceAdapter } from "./contract.js";
import { scanPages } from "./paginated-scan.js";
import { classifyJobType } from "./job-type.js";

function publicUrl(value, base) {
  try {
    const u = new URL(value, base);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

const SEEK_GENERIC_COMPANY = /^(?:internship|full[- ]?time|part[- ]?time|contract|temporary)$/iu;
// Some advertisers' registered names carry a CSS rule, and SEEK shows it as the company.
const SEEK_CSS_COMPANY = /[#.][\w-]+(?:[.#][\w-]+)*\s*\{[^}]*\}/u;
const SEEK_DOMAIN_END = /\.(?:com(?:\.sg)?|co(?:\.uk)?|sg|tech|net|org|io|ai)$/iu;

function splitRepeatedDomainLabel(value) {
  const match = value.match(/^(.+?)(\.(?:com(?:\.sg)?|co(?:\.uk)?|sg|tech|net|org|io|ai))$/iu);
  if (!match) return null;
  const joined = match[1];
  const compact = (text) =>
    text
      .normalize("NFKC")
      .toLocaleLowerCase("en")
      .replace(/[^\p{L}\p{N}]+/gu, "");
  for (let index = 3; index < joined.length - 2; index++) {
    const left = joined.slice(0, index).trim();
    const right = joined.slice(index).trim();
    if (compact(left).length >= 3 && compact(left) === compact(right)) return left;
  }
  return null;
}

export function normalizeSeekCompany(value) {
  const rawCompany = String(value ?? "").trim();
  if (!rawCompany) return { company: "", rawCompany: "", warning: null };
  if (SEEK_GENERIC_COMPANY.test(rawCompany) || SEEK_CSS_COMPANY.test(rawCompany))
    return { company: "", rawCompany, warning: "source_company_unresolved" };
  if (/hyperscal\.com$/iu.test(rawCompany))
    return {
      company: rawCompany.replace(/hyperscal\.com$/iu, "").trim(),
      rawCompany,
      warning: "source_company_normalized",
    };
  const legal = rawCompany.match(
    /^(.+?\b(?:Pte\.?\s*Ltd\.?|Private\s+Limited|Ltd\.?|Limited|Inc\.?|LLC|PLC))(?=\s*[a-z0-9-]+(?:\.[a-z0-9-]+)+$)/iu,
  );
  if (legal) return { company: legal[1].trim(), rawCompany, warning: "source_company_normalized" };
  if (SEEK_DOMAIN_END.test(rawCompany)) {
    const repeated = splitRepeatedDomainLabel(rawCompany);
    if (repeated) return { company: repeated, rawCompany, warning: "source_company_normalized" };
  }
  return { company: rawCompany, rawCompany, warning: null };
}
// Runs inside the source's own window, sent there as text with the profile as its only
// argument, so it must not use anything from this module.
// Only job-card fields and structural page signals cross the browser boundary.
// Passwords, cookies, account information and full page HTML are never extracted.
function readPortalPage(p) {
  const text = (root, selector) =>
    selector ? (root.querySelector(selector)?.textContent?.trim() ?? "") : "";
  const lagouJobs = (() => {
    if (p.cardLink !== "lagou-react-job") return [];
    const root = document.querySelector(p.card);
    let fiber = root?.[Object.keys(root).find((key) => key.startsWith("__reactInternalInstance"))];
    for (let depth = 0; fiber && depth < 8; depth++, fiber = fiber.return) {
      const rows = fiber.memoizedProps?.content?.positionResult?.result;
      if (Array.isArray(rows)) return rows;
    }
    return [];
  })();
  const publicJob = (root, index) =>
    p.cardLink === "zhaopin-visible-job"
      ? (root.__vue__?.$props ?? root.__vueParentComponent?.props)?.job
      : p.cardLink === "lagou-react-job"
        ? lagouJobs[index]
        : null;
  const cardUrl = (root, index) => {
    const linkElement = root.matches(p.link) ? root : root.querySelector(p.link);
    const anchor = linkElement?.href;
    if (p.cardLink === "indeed-job-key") {
      // /rc/clk and /pagead/clk carry a per-session token; the card's own job key is stable.
      const key =
        linkElement?.getAttribute("data-jk") ??
        root.querySelector("[data-jk]")?.getAttribute("data-jk") ??
        "";
      if (/^[0-9a-f]{8,32}$/i.test(key)) return location.origin + "/viewjob?jk=" + key;
    }
    if (anchor) return anchor;
    if (p.cardLink === "zhaopin-visible-job") {
      // Read only the URL attached to this displayed card, never app/account state.
      const job = publicJob(root, index);
      try {
        const u = new URL(job?.positionURL ?? job?.positionUrl);
        if (
          ["http:", "https:"].includes(u.protocol) &&
          u.hostname === "www.zhaopin.com" &&
          /^\/jobdetail\/[\w-]+\.htm$/.test(u.pathname) &&
          !u.username &&
          !u.password
        ) {
          u.protocol = "https:";
          return u.href;
        }
      } catch {}
    }
    if (p.cardLink === "lagou-react-job") {
      const id = String(publicJob(root, index)?.positionId ?? "");
      if (/^\d{5,20}$/.test(id)) return "https://www.lagou.com/wn/jobs/" + id + ".html";
    }
    if (p.cardLink === "51job-exposure-id") {
      // This card carries no anchor; read only the job id this card already exposes.
      try {
        const exposure = root.querySelector("[sensorsdata]")?.getAttribute("sensorsdata") ?? "{}";
        const id = String(JSON.parse(exposure).jobId ?? "");
        if (/^\d{5,20}$/.test(id)) return "https://jobs.51job.com/all/" + id + ".html";
      } catch {}
    }
    return "";
  };
  const cards = [...document.querySelectorAll(p.card)]
    .filter((root) => !p.blocked || !root.closest(p.blocked))
    .map((root, index) => {
      const job = publicJob(root, index);
      const title = p.titleFirstLine
        ? root.querySelector(p.title)?.innerText?.trim().split("\n")[0]
        : text(root, p.title);
      const place = p.locationAll
        ? [...root.querySelectorAll(p.location)].map((e) => e.textContent.trim()).join(" ")
        : text(root, p.location);
      return {
        title: title || String(job?.name ?? job?.positionName ?? "").trim(),
        company:
          text(root, p.company) ||
          String(job?.companyName ?? job?.companyShortName ?? job?.companyFullName ?? "").trim(),
        location: place || String(job?.workCity ?? "").trim(),
        url: cardUrl(root, index),
        postedText: text(root, "time"),
        description: text(root, p.description),
        classification: text(root, p.classification),
        subClassification: text(root, p.subClassification),
        employmentText:
          text(root, '[data-automation="jobWorkType"], [data-testid="job-type"], .job-type') ||
          String(job?.jobNature ?? "").trim(),
      };
    })
    .filter((c) => c.title && (c.company || p.allowMissingCompany) && c.url);
  const nextByText = p.nextText
    ? [...document.querySelectorAll(p.nextTextSelector ?? "button")].find(
        (e) => e.textContent.trim().toLowerCase() === p.nextText.toLowerCase(),
      )
    : null;
  const next = (p.next ? document.querySelector(p.next) : null) ?? nextByText;
  const lastPageUrl = p.lastText
    ? [...document.querySelectorAll("a[href]")].find((e) => e.textContent.trim() === p.lastText)
        ?.href
    : null;
  const disabled =
    next &&
    (next.disabled ||
      next.getAttribute("aria-disabled") === "true" ||
      next.closest('[aria-disabled="true"], .ant-pagination-disabled'));
  const nextHref = next?.getAttribute("href");
  const link = nextHref && !/^(#|javascript:)/i.test(nextHref) ? next.href : null;
  const visible = (e) => {
    if (!e || !e.getClientRects().length) return false;
    const r = e.getBoundingClientRect();
    if (
      r.width < 1 ||
      r.height < 1 ||
      r.bottom <= 0 ||
      r.right <= 0 ||
      r.top >= innerHeight ||
      r.left >= innerWidth
    ) {
      return false;
    }
    for (let node = e; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        style.pointerEvents === "none"
      ) {
        return false;
      }
    }
    return true;
  };
  const anyVisible = (selector) => [...document.querySelectorAll(selector)].some(visible);
  const challenge =
    anyVisible(
      'iframe[src*="captcha"],iframe[src*="challenge"],#challenge-running,#captcha,.geetest_panel',
    ) || /\/captcha|\/challenge|\/verify/i.test(location.pathname);
  const login =
    anyVisible('input[type="password"],form[action*="login"],form[action*="signin"]') ||
    /\/(login|signin|sign-in|auth)(\/|$)/i.test(location.pathname);
  const authenticated = anyVisible(
    'a[href*="/logout"],form[action*="/logout"],button[data-testid="logout"]',
  );
  const empty = Boolean(p.empty && anyVisible(p.empty));
  const totalText = p.total ? text(document, p.total) : "";
  const totalMatch =
    p.totalPattern === "parentheses"
      ? totalText.match(/\(([\d,]+)\)\s*$/)
      : totalText.match(/^([\d,]+)$/);
  const total = totalMatch ? Number(totalMatch[1].replaceAll(",", "")) : null;
  const required = p.requiredLocation?.toLowerCase();
  return {
    url: location.href,
    cards,
    challenge,
    login,
    authenticated,
    empty,
    lastPageUrl,
    regionMismatch: Boolean(
      required && cards.length && !cards.some((c) => c.location.toLowerCase().includes(required)),
    ),
    loginGate: Boolean(p.gate && anyVisible(p.gate)),
    nextUrl: !p.forceButtonPagination && !disabled && link && /^https:/.test(link) ? link : null,
    nextButton: Boolean(next && !disabled && (!link || p.forceButtonPagination)),
    endConfirmed:
      Boolean(disabled) ||
      empty ||
      (!next && total !== null && new Set(cards.map((c) => c.url)).size >= total),
  };
}

export function portalSnapshotScript(profile) {
  return pageCall(readPortalPage, profile);
}

// A function to run in the source's window, written out with its arguments as JSON.
function pageCall(fn, ...args) {
  return `(${fn})(${args.map((value) => JSON.stringify(value ?? null)).join(",")})`;
}

// The page-side steps below run like readPortalPage: as text, with their values as arguments.
function submitPageSearch(selector, query) {
  const input = document.querySelector(selector);
  if (!input || !input.form) return false;
  // A framework-controlled input only notices a value set through the native setter.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, query);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.form.requestSubmit();
  return true;
}

function findResultsView(selector) {
  if (!location.pathname.includes("/jobsearch/")) return null;
  return (
    document.querySelector(selector)?.href ??
    (location.pathname.includes("/joblist/") ? location.href : null)
  );
}

function clickNextPage(selector, textSelector, label) {
  const b =
    (selector ? document.querySelector(selector) : null) ??
    [...document.querySelectorAll(textSelector)].find(
      (e) => e.textContent.trim().toLowerCase() === label,
    );
  if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return false;
  b.click();
  return true;
}

// Scrolls the nearest scrollable box around the job cards, or the page itself.
function scrollJobList(cardSelector) {
  let e = document.querySelector(cardSelector)?.parentElement;
  while (
    e &&
    !(e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY))
  ) {
    e = e.parentElement;
  }
  e = e ?? document.scrollingElement;
  e.scrollTop += Math.max(300, e.clientHeight * 0.8);
  return { atEnd: e.scrollTop + e.clientHeight >= e.scrollHeight - 4 };
}

// Some listings state the location only inside the job title, e.g. "数据分析师[北京·朝阳门]".
// Reading it out is reading what the listing shows; a title without such a suffix keeps its text.
export function splitTitleLocation(title) {
  const match = title.match(/^(.*\S)\s*[[［]([^\][［］]{2,40})[\]］]\s*$/u);
  return match ? { title: match[1].trim(), location: match[2].trim() } : { title, location: "" };
}

// Scrolling stops on the first of: the end of the list holding still for a few seconds, a
// run of rounds that reveal nothing new, or this ceiling. None of them is proof of completeness.
export const MAX_SCROLL_ROUNDS = 150;
// Rounds are about half a second apart. Three of them ended a feed that takes over a second
// to append its next batch (Zhaopin's does), so the end must hold for about three seconds.
const SETTLED_END_ROUNDS = 7;
// An already-loaded page reveals nothing new while the scroll is still travelling to its
// bottom, so the "nothing new" rule must not fire before a page has had time to get there.
const MIN_SCROLL_ROUNDS = 45;
const UNPRODUCTIVE_SCROLL_ROUNDS = 10;

export function createPortalAdapter(
  sourceId,
  {
    pause = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => new Date().toISOString(),
  } = {},
) {
  const profile = PORTAL_PROFILES[sourceId];
  if (!profile) throw new RangeError(`No portal profile for ${sourceId}`);
  const script = portalSnapshotScript(profile);
  // A live viewport is reusable only by the task that stopped scrolling here.
  // A URL restored from disk alone cannot prove which pages the window has read.
  let ownedScrollCheckpoint = null;
  function capability(snapshot) {
    const resultCount = snapshot.empty
      ? 0
      : (snapshot.cards ?? []).filter(
          (c) =>
            c.title?.trim() &&
            (c.company?.trim() || profile.allowMissingCompany) &&
            publicUrl(c.url, snapshot.url),
        ).length;
    if (snapshot.challenge)
      return validateCapability({
        authentication: "challenge",
        extraction: "blocked",
        page: "challenge",
        resultCount,
        reason: "challenge_required",
      });
    if (snapshot.regionMismatch)
      return validateCapability({
        authentication: "unknown",
        extraction: "blocked",
        page: "search_results",
        resultCount,
        reason: "region_filter_not_applied",
      });
    if (snapshot.login && !resultCount)
      return validateCapability({
        authentication: "signed_out",
        extraction: "blocked",
        page: "login",
        resultCount,
        reason: "sign_in_required",
      });
    const readable = resultCount > 0 || snapshot.empty === true;
    // Readability alone proves access, not that an account is authenticated.
    return validateCapability({
      authentication: snapshot.loginGate
        ? "signed_out"
        : snapshot.authenticated
          ? "signed_in"
          : readable
            ? "not_required"
            : "unknown",
      extraction: readable ? "ready" : "unknown",
      page: readable ? "search_results" : "unknown",
      resultCount,
      reason: snapshot.loginGate ? "sign_in_required" : readable ? null : "job_results_not_ready",
    });
  }
  // Several portals render their first result batch well past load; a short budget
  // reports a slow page as an unreadable one. Bounded, and exits as soon as cards appear.
  const SETTLE_ATTEMPTS = 24;
  async function settle(driver) {
    let snapshot;
    for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt++) {
      snapshot = await driver.snapshot(script);
      const c = capability(snapshot);
      if (
        c.extraction === "ready" ||
        c.authentication === "challenge" ||
        c.authentication === "signed_out"
      )
        break;
      if (attempt < SETTLE_ATTEMPTS - 1) await pause(500);
    }
    return snapshot;
  }
  async function submitSearchForm(driver, query) {
    if (!profile.searchForm) return;
    if (!driver.act)
      throw new SourceAdapterError(
        "search_form_unavailable",
        "Desktop search form interaction is required / 需要桌面搜索表单操作",
      );
    const submitted = await driver.act(pageCall(submitPageSearch, profile.searchForm, query));
    if (!submitted)
      throw new SourceAdapterError(
        "search_form_unavailable",
        "The official search form is unavailable / 官方搜索表单暂不可用",
      );
    if (profile.resultsViewLink) {
      for (let attempt = 0; attempt < 20; attempt++) {
        await pause(500);
        const target = await driver.act(pageCall(findResultsView, profile.resultsViewLink));
        if (typeof target === "string") {
          await driver.navigate(target);
          return;
        }
      }
      throw new SourceAdapterError(
        "search_results_not_ready",
        "The search result list has not loaded / 搜索结果列表尚未加载",
      );
    }
    await pause(500);
    await driver.waitForReady();
  }
  function normalize(card, source, task) {
    const url = publicUrl(card.url, task.searchUrl);
    if (!url || !card.title?.trim() || (!card.company?.trim() && !profile.allowMissingCompany))
      return null;
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()])
      if (/^utm_|^tracking|^(?:ref|traceInfo)$/i.test(key)) u.searchParams.delete(key);
    if (profile.stripHash) u.hash = "";
    if (["cn-nowcoder", "cn-liepin"].includes(sourceId))
      for (const key of [...u.searchParams.keys()]) {
        if (
          /^(?:logid|pgRef|d_.+|skId|fkId|ckId|sfrom|curPage|pageSize|index|deliverSource|pageSource|channel|activityId|fromSource)$/i.test(
            key,
          )
        )
          u.searchParams.delete(key);
      }
    const companyEvidence =
      profile.companyCleanup === "seek"
        ? normalizeSeekCompany(card.company)
        : {
            company: card.company?.trim() ?? "",
            rawCompany: card.company?.trim() ?? "",
            warning: null,
          };
    const titleEvidence = profile.locationInTitle
      ? splitTitleLocation(card.title.trim())
      : { title: card.title.trim(), location: "" };
    return {
      title: titleEvidence.title,
      company: companyEvidence.company,
      rawCompany: companyEvidence.rawCompany,
      url: u.href,
      location: (card.location || titleEvidence.location) ?? "",
      postedText: card.postedText ?? "",
      source: source.name,
      sourceId,
      sourceTaskId: task.id,
      employmentType: classifyJobType(card.title, card.employmentText),
      targetEmploymentType: task.employmentType,
      market: task.market,
      verification: "source_checked",
      firstSeenAt: now(),
      lastSeenAt: now(),
      skills: [],
      description: card.description ?? "",
      classification: card.classification ?? "",
      subClassification: card.subClassification ?? "",
      sourceFieldWarnings: companyEvidence.warning ? [companyEvidence.warning] : [],
    };
  }
  return Object.freeze(
    validateSourceAdapter({
      id: `portal-${sourceId}`,
      sourceIds: [sourceId],
      navigationHosts: ["accounts.google.com", ...(profile.signInHosts ?? [])],
      async inspect({ driver }) {
        return capability(await driver.snapshot(script));
      },
      async probe({ driver, source }) {
        const query = source.market === "CN" ? "数据分析" : "Data Analyst";
        await driver.navigate(source.searchUrl(query));
        await driver.waitForReady();
        await submitSearchForm(driver, query);
        return capability(await settle(driver));
      },
      async discover({
        driver,
        source,
        task,
        maxPages = 20,
        onProgress,
        shouldStop = () => false,
      }) {
        if (source.id !== sourceId || task.sourceId !== sourceId)
          throw new TypeError("Source task mismatch");
        let previousNextButton = false,
          previousSnapshot = null,
          pageNumber = 1;
        let firstRead = true;
        const scrollCheckpoint = ownedScrollCheckpoint;
        ownedScrollCheckpoint = null;
        let lastPageUrl = null;
        const resumeMatch = task.resumeUrl?.match(/#career-radar-page=(\d+)$/);
        const resumePage = resumeMatch ? Number(resumeMatch[1]) : 1;
        const signature = (s) =>
          (s.cards ?? [])
            .map((c) => c.url)
            .sort()
            .join("\n");
        async function clickNext(before) {
          if (!driver.act)
            throw new SourceAdapterError(
              "pagination_unavailable",
              "Pagination needs browser interaction",
            );
          const clicked = await driver.act(
            pageCall(
              clickNextPage,
              profile.next,
              profile.nextTextSelector ?? "button",
              (profile.nextText ?? "").toLowerCase(),
            ),
          );
          if (!clicked)
            throw new SourceAdapterError(
              "pagination_unavailable",
              "Next-page control is unavailable / 下一页按钮不可用",
            );
          for (let i = 0; i < 16; i++) {
            if (shouldStop()) throw new SourceAdapterError("cancelled", "Paused / 已暂停");
            await pause(500);
            const after = await driver.snapshot(script),
              c = capability(after);
            if (c.authentication === "challenge" || c.authentication === "signed_out")
              throw new SourceAdapterError(
                c.reason,
                "Source needs login or verification / 来源需要登录或验证",
                { capability: c },
              );
            if (after.empty || (signature(after) && signature(after) !== signature(before)))
              return after;
          }
          throw new SourceAdapterError(
            "pagination_not_advanced",
            "Next page did not produce new cards / 翻页后未出现新的职位卡片",
          );
        }
        const readPage = async (url) => {
          let snapshot;
          if (previousNextButton) {
            snapshot = await clickNext(previousSnapshot);
            pageNumber++;
          } else {
            if (
              firstRead &&
              task.resumeUrl === url &&
              !resumeMatch &&
              !profile.searchForm &&
              scrollCheckpoint?.taskId === task.id &&
              scrollCheckpoint.resumeUrl === url
            ) {
              const current = await driver.snapshot(script);
              try {
                const actual = new URL(current.url),
                  expected = new URL(scrollCheckpoint.pageUrl);
                actual.searchParams.sort();
                expected.searchParams.sort();
                if (actual.href === expected.href && capability(current).extraction === "ready")
                  snapshot = current;
              } catch {}
            }
            if (!snapshot) {
              await driver.navigate(
                profile.searchForm || url.includes("#career-radar-page=") ? task.searchUrl : url,
              );
              await driver.waitForReady();
              await submitSearchForm(
                driver,
                task.query ??
                  task.roleTitle ??
                  (source.market === "CN" ? "数据分析" : "Data Analyst"),
              );
              snapshot = await settle(driver);
            }
            // Some portals only expose a button. Replay navigation to the saved page; do not invent a server URL.
            if (resumePage > 1 && pageNumber === 1) {
              if (resumePage > 100)
                throw new SourceAdapterError(
                  "resume_limit",
                  "Resume page exceeds the safe navigation limit / 续扫页数超过安全导航上限",
                );
              while (pageNumber < resumePage) {
                snapshot = await clickNext(snapshot);
                pageNumber++;
              }
            }
          }
          firstRead = false;
          let c = capability(snapshot);
          if (c.extraction !== "ready")
            throw new SourceAdapterError(
              c.reason,
              "Open the source window to complete login or check site access. / 请在来源窗口完成登录或检查网站访问。",
              { capability: c },
            );
          if (snapshot.empty)
            return {
              jobs: [],
              capability: c,
              completePage: true,
              nextUrl: null,
              endConfirmed: true,
            };
          const jobs = new Map();
          let stable = 0,
            unproductive = 0,
            completePage = !driver.act;
          // A fixed round count cut a still-productive feed short while grinding through a
          // stuck one. Keep scrolling while rounds still reveal jobs, give up quickly once
          // they stop, and keep a hard ceiling so no page can scroll forever.
          for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
            const known = jobs.size;
            for (const card of snapshot.cards ?? []) {
              const j = normalize(card, source, task);
              if (j) jobs.set(j.url, j);
            }
            unproductive = jobs.size > known ? 0 : unproductive + 1;
            if (shouldStop())
              return {
                jobs: [...jobs.values()],
                capability: c,
                completePage: false,
                stopReason: "cancelled",
              };
            if (
              !driver.act ||
              (round >= MIN_SCROLL_ROUNDS && unproductive >= UNPRODUCTIVE_SCROLL_ROUNDS)
            )
              break;
            const scroll = await driver.act(pageCall(scrollJobList, profile.card));
            await pause(450);
            snapshot = await driver.snapshot(script);
            c = capability(snapshot);
            if (c.extraction !== "ready")
              return {
                jobs: [...jobs.values()],
                capability: c,
                completePage: false,
                stopReason: c.reason,
              };
            const newJobs = (snapshot.cards ?? [])
              .map((card) => normalize(card, source, task))
              .filter(Boolean);
            stable = scroll.atEnd && newJobs.every((j) => jobs.has(j.url)) ? stable + 1 : 0;
            if (stable >= SETTLED_END_ROUNDS) {
              completePage = true;
              break;
            }
          }
          lastPageUrl = snapshot.url;
          let lastPage = false;
          if (profile.lastText && snapshot.lastPageUrl) {
            try {
              const here = new URL(snapshot.url),
                last = new URL(snapshot.lastPageUrl);
              const current = Number(here.searchParams.get("page") ?? 1),
                terminal = Number(last.searchParams.get("page"));
              lastPage =
                here.origin === last.origin &&
                here.pathname === last.pathname &&
                Number.isInteger(current) &&
                Number.isInteger(terminal) &&
                current > 0 &&
                terminal > 0 &&
                current >= terminal;
            } catch {}
          }
          previousNextButton = !lastPage && snapshot.nextButton === true;
          previousSnapshot = snapshot;
          const nextUrl = lastPage
            ? null
            : (snapshot.nextUrl ??
              (previousNextButton
                ? `${task.searchUrl.split("#")[0]}#career-radar-page=${pageNumber + 1}`
                : null));
          return {
            jobs: [...jobs.values()],
            capability: c,
            completePage: completePage && !snapshot.loginGate,
            nextUrl,
            stopReason: snapshot.loginGate
              ? "sign_in_required"
              : !completePage
                ? "scroll_limit"
                : undefined,
            endConfirmed: lastPage || snapshot.endConfirmed === true || snapshot.empty === true,
          };
        };
        // Button checkpoints are interpreted locally and never sent as invented pagination parameters.
        const startUrl = task.resumeUrl ?? task.searchUrl;
        const result = await scanPages({ startUrl, readPage, maxPages, onProgress, shouldStop });
        if (result.scan.stopReason === "scroll_limit" && lastPageUrl) {
          ownedScrollCheckpoint = {
            taskId: task.id,
            resumeUrl: result.scan.nextUrl,
            pageUrl: lastPageUrl,
          };
        }
        if (!result.scan.pagesRead)
          throw new SourceAdapterError(
            result.scan.stopReason,
            "Source reading needs attention / 来源读取需要处理",
            { capability: result.capability },
          );
        return result;
      },
    }),
  );
}

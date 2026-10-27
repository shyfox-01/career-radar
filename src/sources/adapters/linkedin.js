import { SourceAdapterError, validateCapability, validateSourceAdapter } from "./contract.js";
import { scanPages } from "./paginated-scan.js";
import { classifyJobType } from "./job-type.js";

const LINKEDIN_SOURCE_IDS = Object.freeze(["sg-linkedin", "hk-linkedin"]);

// Runs inside the LinkedIn window, sent there as text, so it must not use anything from
// this module. It returns job-card fields and page signals only.
function readLinkedInPage() {
  const text = (root, selectors) => {
    for (const selector of selectors) {
      const value = root.querySelector(selector)?.textContent?.trim();
      if (value) return value;
    }
    return "";
  };
  const countAll = (selectors) =>
    selectors.reduce((total, selector) => total + document.querySelectorAll(selector).length, 0);

  // The signed-in "AI search" page has generated class names and no link on its list cards.
  // Each card names its own job id in its componentkey; the link is built from that id only.
  const newCardKey = "job-card-component-ref-";
  const newCardSelector = '[componentkey^="' + newCardKey + '"]';
  const newRoots = [...document.querySelectorAll(newCardSelector)].filter(
    (root) => !root.parentElement?.closest(newCardSelector),
  );

  // The classic page: a card is the list item around a /jobs/view/ link.
  const roots = [
    ...new Set(
      [...document.querySelectorAll('a[href*="/jobs/view/"]')]
        .map(
          (a) =>
            a.closest("li.scaffold-layout__list-item, li.jobs-search-results__list-item") ??
            a.closest(".job-card-container, .base-card") ??
            a.closest("li"),
        )
        .filter(
          (root) => root && !newRoots.some((card) => card.contains(root) || root.contains(card)),
        ),
    ),
  ];
  const cards = roots
    .map((root) => ({
      title: text(root, [
        ".job-card-list__title",
        ".job-card-container__link",
        ".base-search-card__title",
        "strong",
      ]),
      company: text(root, [
        ".job-card-container__primary-description",
        ".base-search-card__subtitle",
        ".job-card-container__company-name",
        ".artdeco-entity-lockup__subtitle",
      ]),
      location: text(root, [
        ".job-card-container__metadata-wrapper",
        ".artdeco-entity-lockup__caption",
        ".job-card-container__metadata-item",
        ".job-search-card__location",
      ]),
      url: root.querySelector('a[href*="/jobs/view/"]')?.href ?? "",
      postedText: text(root, ["time", ".job-search-card__listdate"]),
      description: root.getAttribute("aria-label") ?? "",
    }))
    .filter((card) => card.title && card.url);

  // A new-style card's text runs: the title (twice, once with a verification note),
  // company, location, then badges and a hidden posting time.
  const leaves = (root) => {
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          const value = child.textContent.trim();
          if (value) out.push({ tag: node.tagName, value });
        } else if (child.nodeType === 1) {
          walk(child);
        }
      }
    };
    walk(root);
    return out;
  };
  for (const root of newRoots) {
    const id = root.getAttribute("componentkey").slice(newCardKey.length);
    if (!/^\d{6,12}$/.test(id)) continue;
    const parts = leaves(root);
    const spans = parts
      .filter((part) => part.tag === "SPAN")
      .map((part) => part.value.replace(/^(?:已选中，|Selected,\s*)/i, "").trim());
    const title = spans[1] && spans[0]?.startsWith(spans[1]) ? spans[1] : (spans[0] ?? "");
    const lines = parts
      .filter((part) => part.tag === "P" && part.value !== "·")
      .map((part) => part.value);
    const posted =
      parts
        .map((part) => part.value.match(/^(?:已发布的时间|Posted on|Posted)[:：]?\s*(.+)$/i)?.[1])
        .find(Boolean) ?? "";
    if (title) {
      cards.push({
        title,
        company: lines[0] ?? "",
        location: lines[1] ?? "",
        url: "https://www.linkedin.com/jobs/view/" + id + "/",
        postedText: posted,
        description: "",
      });
    }
  }

  const uniqueCardCount = new Set(
    cards.map((c) => c.url.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/)?.[1]).filter(Boolean),
  ).size;
  const totalText =
    document.querySelector(".jobs-search-results-list__subtitle")?.textContent?.trim() ?? "";
  const totalMatch = totalText.match(
    /^([\d,]+)\s*(?:results?|个结果|个职位|个职缺|個職缺|份職缺)/i,
  );
  const total = totalMatch ? Number(totalMatch[1].replaceAll(",", "")) : null;
  const next = document.querySelector(
    '.artdeco-pagination__button--next, .jobs-search-pagination__button--next, button[aria-label="Next"], button[aria-label*="next page" i], button[aria-label*="下一页"]',
  );
  const nextDisabled = Boolean(
    next && (next.disabled || next.getAttribute("aria-disabled") === "true"),
  );
  const pagination = document.querySelector(
    '.artdeco-pagination, .jobs-search-pagination, [aria-label="Pagination"], [aria-label="分页"]',
  );
  const pageNumbers = (pagination?.textContent ?? "").match(
    /(?:Page|第)\s*(\d+)\s*(?:of|\/)\s*(\d+)/i,
  );
  const lastPage = Boolean(
    pageNumbers && Number(pageNumbers[1]) === Number(pageNumbers[2]) && Number(pageNumbers[2]) > 0,
  );
  const currentUrl = new URL(location.href);
  const start = Number(currentUrl.searchParams.get("start")) || 0;
  const nextUrl = new URL(currentUrl);
  nextUrl.searchParams.set("start", String(start + 25));

  // The new page labels its page buttons "第 2 页" or "Page 2". No button for the following
  // number means this is the last page; a short list with no buttons is a single page.
  const pageButtons = [...document.querySelectorAll("button[aria-label]")]
    .map((button) => {
      const label = button.getAttribute("aria-label").match(/^(?:第\s*(\d+)\s*页|Page\s+(\d+))$/i);
      return { button, n: Number((label ?? []).slice(1).find(Boolean)) };
    })
    .filter((entry) => entry.n);
  const currentPage =
    pageButtons.find((entry) =>
      ["true", "page"].includes(entry.button.getAttribute("aria-current")),
    )?.n ?? Math.floor(start / 25) + 1;
  const numbered = newRoots.length > 0 && pageButtons.length > 0;
  const numberedNext = numbered && pageButtons.some((entry) => entry.n === currentPage + 1);
  const singleNewPage = newRoots.length > 0 && pageButtons.length === 0 && newRoots.length < 25;

  let hasNext;
  let endConfirmed;
  if (numbered) {
    hasNext = numberedNext;
    endConfirmed = !numberedNext;
  } else {
    hasNext =
      !singleNewPage && !lastPage && ((next && !nextDisabled) || (!next && uniqueCardCount >= 25));
    endConfirmed =
      singleNewPage ||
      lastPage ||
      nextDisabled ||
      (!next && total !== null && uniqueCardCount + start >= total);
  }

  return {
    pagination: {
      nextUrl: hasNext ? nextUrl.href : null,
      endConfirmed,
      present: Boolean(pagination || next || numbered),
    },
    url: location.href,
    title: document.title,
    challengeText: [
      ...document.querySelectorAll(
        'form[action*="checkpoint"], #captcha-internal, [data-test-id*="challenge"]',
      ),
    ]
      .map((e) => e.innerText?.slice(0, 500) ?? "")
      .join(" "),
    markers: {
      authenticated: countAll([
        'a[href*="/mynetwork/"]',
        'a[href$="/mynetwork"]',
        'a[href*="/messaging/"]',
        'button[aria-label*="Me"]',
        ".global-nav__me",
        '[componentkey="primaryNavLinksComponentRef"]',
      ]),
      signedOut: countAll(['a[href*="/login"]', ".authwall-join-form", ".sign-in-form"]),
      challenge: countAll([
        'form[action*="checkpoint"]',
        "#captcha-internal",
        '[data-test-id*="challenge"]',
      ]),
      searchSurface: countAll([
        ".jobs-search-results-list",
        ".jobs-search-results__list",
        "main.jobs-search",
      ]),
      noResults: countAll([".jobs-search-no-results-banner", ".jobs-search-no-results"]),
    },
    cards,
  };
}

// Scrolls the nearest scrollable box around the job cards, or the page itself.
function scrollLinkedInList() {
  const card = document.querySelector(
    '.job-card-container, .base-card, [componentkey^="job-card-component-ref-"]',
  );
  let container = card?.parentElement;
  while (
    container &&
    !(
      container.scrollHeight > container.clientHeight + 40 &&
      /auto|scroll/.test(getComputedStyle(container).overflowY)
    )
  ) {
    container = container.parentElement;
  }
  container = container ?? document.scrollingElement;
  const before = container.scrollTop;
  container.scrollTop = Math.min(
    container.scrollHeight,
    before + Math.max(300, container.clientHeight * 0.8),
  );
  return {
    atEnd: container.scrollTop + container.clientHeight >= container.scrollHeight - 4,
    moved: container.scrollTop !== before,
  };
}

const LINKEDIN_SNAPSHOT_SCRIPT = `(${readLinkedInPage})()`;
const LINKEDIN_SCROLL_SCRIPT = `(${scrollLinkedInList})()`;

function count(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function canonicalLinkedInJobUrl(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)linkedin\.com$/iu.test(url.hostname)) return null;
    const match = url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/u);
    if (!match) return null;
    return `https://www.linkedin.com/jobs/view/${match[1]}`;
  } catch {
    return null;
  }
}

export function interpretLinkedInSnapshot(snapshot) {
  const url = String(snapshot?.url ?? "");
  const title = String(snapshot?.title ?? "");
  const bodyText = String(snapshot?.challengeText ?? "");
  const markers = snapshot?.markers ?? {};
  const resultCount =
    count(markers.noResults) > 0
      ? 0
      : Array.isArray(snapshot?.cards)
        ? snapshot.cards.filter(
            (card) => String(card?.title ?? "").trim() && canonicalLinkedInJobUrl(card?.url),
          ).length
        : 0;
  const challenge =
    count(markers.challenge) > 0 ||
    /\/checkpoint\/(?:challenge|checkpoint)/iu.test(url) ||
    /security verification|quick security check|验证.{0,4}(?:身份|安全)/iu.test(
      `${title} ${bodyText}`,
    );
  if (challenge) {
    return validateCapability({
      authentication: "challenge",
      extraction: "blocked",
      page: "challenge",
      resultCount,
      reason: "challenge_required",
    });
  }

  const authenticated = count(markers.authenticated) > 0;
  const signedOut = count(markers.signedOut) > 0;
  const searchSurface = count(markers.searchSurface) > 0 || /\/jobs\/search/iu.test(url);
  const extraction =
    searchSurface && (resultCount > 0 || count(markers.noResults) > 0) ? "ready" : "unknown";
  return validateCapability({
    authentication: authenticated ? "signed_in" : signedOut ? "signed_out" : "unknown",
    extraction,
    page: searchSurface ? "search_results" : "unknown",
    resultCount,
    reason: authenticated
      ? extraction === "ready"
        ? null
        : "job_results_not_ready"
      : signedOut
        ? "sign_in_required"
        : "authentication_unknown",
  });
}

function normalizeCard(card, { source, task, now }) {
  const title = String(card?.title ?? "").trim();
  const company = String(card?.company ?? "").trim();
  const url = canonicalLinkedInJobUrl(card?.url);
  if (!title || !url) return null;
  return {
    title,
    company,
    location: String(card?.location ?? "").trim(),
    url,
    description: String(card?.description ?? "").trim(),
    skills: [],
    source: source.name,
    sourceId: source.id,
    sourceTaskId: task.id,
    verification: "source_checked",
    firstSeenAt: now,
    lastSeenAt: now,
    postedText: String(card?.postedText ?? "").trim(),
    employmentType: classifyJobType(title),
    targetEmploymentType: task.employmentType,
    market: task.market,
  };
}

export function createLinkedInAdapter({
  now = () => new Date().toISOString(),
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  async function settledSnapshot(driver) {
    // A load event can precede client-rendered job cards. Poll a bounded 8 seconds.
    let snapshot;
    for (let attempt = 0; attempt < 17; attempt += 1) {
      snapshot = await driver.snapshot(LINKEDIN_SNAPSHOT_SCRIPT);
      const capability = interpretLinkedInSnapshot(snapshot);
      if (
        capability.authentication === "challenge" ||
        capability.authentication === "signed_out" ||
        (capability.authentication === "signed_in" && capability.extraction === "ready")
      )
        return snapshot;
      if (attempt < 16) await pause(500);
    }
    return snapshot;
  }
  const adapter = {
    id: "linkedin",
    sourceIds: LINKEDIN_SOURCE_IDS,
    navigationHosts: Object.freeze(["accounts.google.com"]),
    async inspect({ driver }) {
      return interpretLinkedInSnapshot(await driver.snapshot(LINKEDIN_SNAPSHOT_SCRIPT));
    },
    async probe({ driver, source }) {
      if (
        !driver?.snapshot ||
        !driver?.navigate ||
        !driver?.waitForReady ||
        !LINKEDIN_SOURCE_IDS.includes(source?.id)
      ) {
        throw new TypeError("LinkedIn verification needs its source and browser driver");
      }
      // Verify reading on an actual search page, not the feed left open after login.
      await driver.navigate(source.searchUrl(""));
      await driver.waitForReady();
      return interpretLinkedInSnapshot(await settledSnapshot(driver));
    },
    async discover({ driver, source, task, limit = 25, maxPages = 20, onProgress, shouldStop }) {
      if (!LINKEDIN_SOURCE_IDS.includes(source?.id) || task?.sourceId !== source.id) {
        throw new TypeError("LinkedIn adapter received an unsupported source task");
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 25) {
        throw new RangeError("LinkedIn discovery limit must be between 1 and 25");
      }
      if (typeof task.searchUrl !== "string" || !task.searchUrl.startsWith("https://")) {
        throw new TypeError("LinkedIn source task needs a public HTTPS search URL");
      }
      let lastCapability;
      const readPage = async (url) => {
        await driver.navigate(url);
        await driver.waitForReady();
        let snapshot = await settledSnapshot(driver);
        const capability = interpretLinkedInSnapshot(snapshot);
        lastCapability = capability;
        if (capability.authentication !== "signed_in") {
          throw new SourceAdapterError(
            capability.reason ?? "authentication_unknown",
            capability.authentication === "challenge"
              ? "LinkedIn requires a security check in the connected window"
              : "Sign in to LinkedIn in the connected window before automatic discovery",
            { capability },
          );
        }
        if (capability.extraction !== "ready") {
          throw new SourceAdapterError(
            capability.reason ?? "extraction_unavailable",
            "LinkedIn search results are not available for extraction",
            { capability },
          );
        }
        // LinkedIn renders personalized recommendations below a zero-results banner.
        // They are not hits for this query, even if their cards are readable.
        if (count(snapshot.markers?.noResults) > 0)
          return { jobs: [], capability, completePage: true, nextUrl: null, endConfirmed: true };
        const collected = new Map();
        let stable = 0,
          settled = !driver.act;
        for (let round = 0; round < 60; round += 1) {
          for (const card of snapshot.cards ?? []) {
            const job = normalizeCard(card, { source, task, now: now() });
            if (job) collected.set(job.url, job);
          }
          if (shouldStop?.())
            return {
              jobs: [...collected.values()],
              capability,
              completePage: false,
              stopReason: "cancelled",
            };
          if (!driver.act) break;
          const before = collected.size;
          const scroll = await driver.act(LINKEDIN_SCROLL_SCRIPT);
          await pause(450);
          snapshot = await driver.snapshot(LINKEDIN_SNAPSHOT_SCRIPT);
          const current = interpretLinkedInSnapshot(snapshot);
          if (current.authentication !== "signed_in")
            return {
              jobs: [...collected.values()],
              capability: current,
              completePage: false,
              stopReason: current.reason ?? "authentication_unknown",
            };
          const newCards = (snapshot.cards ?? [])
            .map((card) => canonicalLinkedInJobUrl(card.url))
            .filter(Boolean);
          stable =
            scroll.atEnd && newCards.every((url) => collected.has(url)) && before === collected.size
              ? stable + 1
              : 0;
          if (stable >= 3) {
            settled = true;
            break;
          }
        }
        const empty = count(snapshot.markers?.noResults) > 0;
        return {
          jobs: [...collected.values()],
          capability,
          completePage: settled,
          nextUrl: snapshot.pagination?.nextUrl ?? null,
          endConfirmed: empty || snapshot.pagination?.endConfirmed === true,
        };
      };
      const result = await scanPages({
        startUrl: task.resumeUrl ?? task.searchUrl,
        readPage,
        maxPages,
        onProgress,
        shouldStop,
      });
      if (result.scan.pagesRead === 0)
        throw new SourceAdapterError(
          result.scan.stopReason,
          "Sign in to the source window or retry reading",
          { scan: result.scan, capability: result.capability },
        );
      return { ...result, capability: result.capability ?? lastCapability };
    },
  };
  return Object.freeze(validateSourceAdapter(adapter));
}

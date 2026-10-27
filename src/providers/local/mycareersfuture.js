import { LocalModelError } from "./ollama.js";

const SEARCH_API = "https://api.mycareersfuture.gov.sg/v2/search";
const JOB_API = "https://api.mycareersfuture.gov.sg/v2/jobs/";
const JOB_ID = /^[0-9a-f]{32}$/u;
// Detail requests run a few at a time: enough to keep a search quick, few enough to stay
// a polite visitor.
const DETAIL_CONCURRENCY = 4;
const EMPLOYMENT_FILTERS = Object.freeze({
  internship: "Internship/Attachment",
  full_time: "Full Time",
});
const DETAILS_PATH = /^\/job\/[a-z0-9-]+\/[a-z0-9-]+-[0-9a-f]{32}$/u;

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "–",
  mdash: "—",
  bull: "•",
  hellip: "…",
};

export function htmlToText(html) {
  return String(html ?? "")
    .replace(/<\s*(?:br|\/p|\/li|\/h\d|\/div)\b[^>]*>/giu, "\n")
    .replace(/<\s*li\b[^>]*>/giu, "• ")
    .replace(/<[^>]*>/gu, "")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/giu, (match, name) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/[ \t ]+/gu, " ")
    .replace(/\s*\n\s*/gu, "\n")
    .trim();
}

// The link comes from the listing's own jobDetailsUrl, checked against the site's job
// page shape. A record without one is dropped rather than given a constructed address.
function detailsUrl(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.mycareersfuture.gov.sg" ||
      url.username ||
      url.password ||
      !DETAILS_PATH.test(url.pathname)
    )
      return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function location(address) {
  if (!address || address.isOverseas) return String(address?.overseasCountry ?? "").trim();
  return (
    String(address.districts?.[0]?.location ?? "").trim() ||
    [address.building, address.street].filter(Boolean).join(", ")
  );
}

function salary(record) {
  const value = record.salary;
  if (record.metadata?.isHideSalary || !value || !Number.isFinite(value.minimum)) return "";
  const range =
    Number.isFinite(value.maximum) && value.maximum !== value.minimum
      ? `${value.minimum}–${value.maximum}`
      : `${value.minimum}`;
  return `SGD ${range}${value.type?.salaryType ? ` ${value.type.salaryType}` : ""}`;
}

export function normalizeListing(record) {
  const url = detailsUrl(record?.metadata?.jobDetailsUrl);
  const title = String(record?.title ?? "").trim();
  const company = String(record?.postedCompany?.name ?? "").trim();
  if (!url || !title || !company) return null;
  const status = String(record.status?.jobStatus ?? "");
  if (status && !/open/iu.test(status)) return null;
  return {
    title,
    company,
    url,
    location: record.metadata?.isHideCompanyAddress ? "" : location(record.address),
    postedAt: record.metadata?.newPostingDate ?? null,
    expiresAt: record.metadata?.expiryDate ?? null,
    employmentTypes: (record.employmentTypes ?? [])
      .map((entry) => entry?.employmentType)
      .filter(Boolean),
    employmentText: (record.employmentTypes ?? [])
      .map((entry) => entry?.employmentType)
      .filter(Boolean)
      .join(" "),
    positionLevels: (record.positionLevels ?? []).map((entry) => entry?.position).filter(Boolean),
    minimumYearsExperience: Number.isFinite(record.minimumYearsExperience)
      ? record.minimumYearsExperience
      : null,
    salary: salary(record),
    skills: (record.skills ?? [])
      .map((entry) => entry?.skill)
      .filter(Boolean)
      .slice(0, 15),
    categories: (record.categories ?? []).map((entry) => entry?.category).filter(Boolean),
    description: htmlToText(record.description),
  };
}

async function mapLimited(items, limit, task) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// MyCareersFuture's site searches through this public, unauthenticated JSON API. Search
// results leave out the description and the minimum experience, so each listing's own
// detail record is read as well; the screening depends on both.
export function createMyCareersFutureSearch({ fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
  async function detail(id) {
    if (!JOB_ID.test(String(id ?? ""))) return null;
    try {
      const response = await fetchImpl(`${JOB_API}${id}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return null;
      const record = await response.json();
      return record?.uuid === id ? record : null;
    } catch {
      return null;
    }
  }
  return Object.freeze({
    sourceId: "sg-mcf",
    name: "MyCareersFuture",
    async search({ query, employmentType, page = 0, limit = 20 }) {
      const text = String(query ?? "")
        .trim()
        .slice(0, 120);
      if (!text) throw new TypeError("A search query is required");
      const url = new URL(SEARCH_API);
      url.searchParams.set("limit", String(Math.min(Math.max(Math.trunc(limit) || 20, 1), 100)));
      url.searchParams.set("page", String(Math.min(Math.max(Math.trunc(page) || 0, 0), 50)));
      const filter = EMPLOYMENT_FILTERS[employmentType];
      let response;
      try {
        response = await fetchImpl(url.href, {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({ search: text, ...(filter ? { employmentTypes: [filter] } : {}) }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new LocalModelError(
          "source_api_unreachable",
          "MyCareersFuture search is unreachable / 无法连接 MyCareersFuture",
        );
      }
      if (!response.ok)
        throw new LocalModelError(
          "source_api_failed",
          `MyCareersFuture search returned HTTP ${response.status}`,
        );
      const body = await response.json();
      if (!Array.isArray(body?.results))
        throw new LocalModelError("source_api_failed", "MyCareersFuture returned no result list");
      // A failed detail read keeps the listing, without a description.
      const details = await mapLimited(body.results, DETAIL_CONCURRENCY, (result) =>
        detail(result?.uuid),
      );
      const listings = body.results
        .map((result, index) => normalizeListing({ ...result, ...(details[index] ?? {}) }))
        .filter(Boolean)
        .map((listing) =>
          // A vacancy offered as both part time and full time is a full-time match for a
          // full-time search; read the label the listing itself carries for that search.
          filter && listing.employmentTypes.includes(filter)
            ? { ...listing, employmentText: filter }
            : listing,
        );
      return {
        total: Number.isFinite(body.total) ? body.total : null,
        page: Number(url.searchParams.get("page")),
        listings,
      };
    },
  });
}

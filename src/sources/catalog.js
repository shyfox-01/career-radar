import { PORTAL_PROFILES } from "./adapters/portal-profiles.js";
const checkedAt = "2026-09-11";

const query =
  (base, name = "q") =>
  (term) => {
    const url = new URL(base);
    url.searchParams.set(name, term);
    return url.href;
  };
const slug =
  (base, suffix = "-jobs") =>
  (term) =>
    term.trim()
      ? `${base}${encodeURIComponent(term.trim()).replaceAll("%20", "-")}${suffix}`
      : `${base}jobs`;
const landing = (url) => () => url;

// Bounded live listing tests, not a promise of all jobs or every user's access.
const readingEvidence = {
  "sg-linkedin":
    "Data Analyst signed in: 2 pages / 50 records from the AI search page, each link built from the id its card exposes (2026-10-16)",
  "sg-jobstreet": "Data Analyst: 2 pages / 60 records with company and location (2026-10-16)",
  "sg-indeed":
    "Data Analyst: 16 records keyed by the card job key; later pages need an Indeed sign-in (2026-10-16)",
  "sg-efc": "Data Analyst: 2 pages / 30 records with company and location (2026-10-16)",
  "cn-zhipin":
    "数据分析 signed in: 270 records on one scrolled page; signed out, 15 before a sign-in prompt (2026-10-16)",
  "cn-51job":
    "数据分析: 2 pages / 40 records with company, location and a job URL based on the card id (2026-10-16)",
  "cn-zhaopin":
    "数据分析 signed in: 780 records on one scrolled page; signed out, 20 before a sign-in prompt (2026-10-16)",
  "cn-liepin": "数据分析: 2 pages / 52 records with company and location (2026-10-16)",
  "cn-nowcoder":
    "数据分析: 2 pages / 39 keyword-search records, excludes recommendations (2026-10-16)",
  "cn-shixiseng":
    "数据分析: 2 pages / 40 records without sign-in; the site draws some place names in a custom font (2026-10-16)",
  "hk-jobsdb": "Data Analyst: 2 pages / 60 records with company and location (2026-10-16)",
  "hk-ies":
    "Data Analyst form submission: 3 records, terminal page confirmed; this portal list view has no employer column (2026-10-16)",
  "hk-indeed":
    "Data Analyst: 16 records keyed by the card job key; later pages need an Indeed sign-in (2026-10-16)",
  "hk-efc": "Data Analyst: 2 pages / 30 records with company and location (2026-10-16)",
};

const records = [
  // Singapore — government, general, graduate/internship, technology, and finance.
  [
    "sg-mcf",
    "SG",
    "MyCareersFuture",
    "government",
    "direct",
    "https://www.mycareersfuture.gov.sg/search",
    query("https://www.mycareersfuture.gov.sg/search", "search"),
  ],
  // LinkedIn's signed-in search ignores a location name and keeps only its region id (geoId).
  [
    "sg-linkedin",
    "SG",
    "LinkedIn Jobs",
    "general",
    "login",
    "https://www.linkedin.com/jobs/",
    (term) =>
      `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(term)}&location=Singapore&geoId=102454443`,
  ],
  [
    "sg-jobstreet",
    "SG",
    "JobStreet Singapore",
    "general",
    "direct",
    "https://sg.jobstreet.com/",
    slug("https://sg.jobstreet.com/"),
  ],
  [
    "sg-indeed",
    "SG",
    "Indeed Singapore",
    "general",
    "direct",
    "https://sg.indeed.com/",
    query("https://sg.indeed.com/jobs"),
  ],
  [
    "sg-internsg",
    "SG",
    "InternSG",
    "internship",
    "direct",
    "https://www.internsg.com/",
    query("https://www.internsg.com/", "s"),
  ],
  [
    "sg-glints",
    "SG",
    "Glints Singapore",
    "internship",
    "login",
    "https://glints.com/sg/opportunities/jobs/explore",
    query("https://glints.com/sg/opportunities/jobs/explore?country=SG", "keyword"),
  ],
  [
    "sg-grad",
    "SG",
    "GradSingapore",
    "internship",
    "manual",
    "https://gradsingapore.com/jobs",
    landing("https://gradsingapore.com/jobs"),
  ],
  [
    "sg-efc",
    "SG",
    "eFinancialCareers Singapore",
    "finance",
    "direct",
    "https://www.efinancialcareers.sg/",
    query(
      "https://www.efinancialcareers.sg/jobs?countryCode=SG&location=Singapore&pageSize=15",
      "q",
    ),
  ],
  [
    "sg-careersgov",
    "SG",
    "Careers@Gov",
    "government",
    "direct",
    "https://jobs.careers.gov.sg/",
    query("https://jobs.careers.gov.sg/", "s"),
  ],
  [
    "sg-jobscentral",
    "SG",
    "JobsCentral",
    "general",
    "direct",
    "https://jobscentral.com.sg/",
    query("https://jobscentral.com.sg/jobs", "search"),
  ],

  // Mainland China.
  [
    "cn-zhipin",
    "CN",
    "BOSS直聘",
    "general",
    "login",
    "https://www.zhipin.com/",
    query("https://www.zhipin.com/web/geek/jobs", "query"),
  ],
  [
    "cn-zhaopin",
    "CN",
    "智联招聘",
    "general",
    "login",
    "https://www.zhaopin.com/",
    query("https://sou.zhaopin.com/", "kw"),
  ],
  [
    "cn-51job",
    "CN",
    "前程无忧",
    "general",
    "login",
    "https://www.51job.com/",
    query("https://we.51job.com/pc/search", "keyword"),
  ],
  [
    "cn-liepin",
    "CN",
    "猎聘",
    "general",
    "login",
    "https://www.liepin.com/",
    query("https://www.liepin.com/zhaopin/", "key"),
  ],
  [
    "cn-lagou",
    "CN",
    "拉勾",
    "technology",
    "login",
    "https://www.lagou.com/",
    query("https://www.lagou.com/wn/jobs", "kd"),
  ],
  [
    "cn-shixiseng",
    "CN",
    "实习僧",
    "internship",
    "login",
    "https://www.shixiseng.com/",
    query("https://www.shixiseng.com/interns", "keyword"),
  ],
  [
    "cn-yingjiesheng",
    "CN",
    "应届生求职网",
    "internship",
    "direct",
    "https://www.yingjiesheng.com/",
    query("https://q.yingjiesheng.com/pc/search", "keyword"),
  ],
  [
    "cn-nowcoder",
    "CN",
    "牛客校招",
    "technology",
    "login",
    "https://www.nowcoder.com/jobs/recommend/campus",
    query("https://www.nowcoder.com/jobs/school/jobs", "search"),
  ],
  [
    "cn-maimai",
    "CN",
    "脉脉职言",
    "general",
    "manual",
    "https://maimai.cn/",
    query("https://maimai.cn/web/search_center", "query"),
  ],

  // Hong Kong.
  [
    "hk-jobsdb",
    "HK",
    "JobsDB Hong Kong",
    "general",
    "direct",
    "https://hk.jobsdb.com/",
    slug("https://hk.jobsdb.com/"),
  ],
  [
    "hk-ctgoodjobs",
    "HK",
    "CTgoodjobs",
    "general",
    "direct",
    "https://www.ctgoodjobs.hk/",
    landing("https://www.ctgoodjobs.hk/"),
  ],
  [
    "hk-cpjobs",
    "HK",
    "CPJobs",
    "general",
    "direct",
    "https://www.cpjobs.com/hk/en",
    query("https://www.cpjobs.com/hk/en/search", "q"),
  ],
  [
    "hk-ies",
    "HK",
    "Labour Department iES",
    "government",
    "login",
    "https://www.jobs.gov.hk/",
    landing("https://www.jobs.gov.hk/0/en/"),
  ],
  [
    "hk-linkedin",
    "HK",
    "LinkedIn Jobs",
    "general",
    "login",
    "https://www.linkedin.com/jobs/",
    (term) =>
      `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(term)}&location=Hong%20Kong&geoId=103291313`,
  ],
  [
    "hk-indeed",
    "HK",
    "Indeed Hong Kong",
    "general",
    "direct",
    "https://hk.indeed.com/",
    query("https://hk.indeed.com/jobs"),
  ],
  [
    "hk-efc",
    "HK",
    "eFinancialCareers Hong Kong",
    "finance",
    "direct",
    "https://www.efinancialcareers.hk/",
    query(
      "https://www.efinancialcareers.hk/jobs?countryCode=HK&location=Hong%20Kong&pageSize=15",
      "q",
    ),
  ],
  [
    "hk-jijis",
    "HK",
    "JIJIS",
    "internship",
    "manual",
    "https://jijis.org.hk/",
    landing("https://jijis.org.hk/"),
  ],
];

export const SOURCE_CATALOG = Object.freeze(
  records.map(([id, market, name, type, access, evidenceUrl, searchUrl]) => {
    const adapterId = ["sg-linkedin", "hk-linkedin"].includes(id)
      ? "linkedin"
      : PORTAL_PROFILES[id]
        ? `portal-${id}`
        : null;
    return Object.freeze({
      id,
      market,
      name,
      type,
      access,
      adapterId,
      extractionCapability:
        adapterId === "linkedin"
          ? "automated"
          : adapterId
            ? "adapter_unverified"
            : access === "login"
              ? "assisted_only"
              : "unavailable",
      // A source is only a default when a recorded live reading check backs it.
      defaultEnabled: Boolean(readingEvidence[id]),
      listingSupport: readingEvidence[id] ? "tested" : adapterId ? "experimental" : "assisted",
      readingEvidence: readingEvidence[id] ?? null,
      evidenceUrl,
      freshnessEvidence: `Official portal entry checked ${checkedAt}`,
      searchUrl,
    });
  }),
);

export function getMarketSources(market) {
  if (!["SG", "CN", "HK"].includes(market)) throw new RangeError(`Unsupported market: ${market}`);
  return SOURCE_CATALOG.filter((source) => source.market === market);
}

export function getSourceById(id) {
  return SOURCE_CATALOG.find((source) => source.id === id) ?? null;
}

import test from "node:test";
import assert from "node:assert/strict";
import { getSourceById } from "../src/sources/catalog.js";

import * as jobsDomain from "../src/domain/jobs.js";

const { buildSearchPlan, deduplicateJobs, rankJob } = jobsDomain;

test("buildSearchPlan covers every selected market with a tested native reader", () => {
  const plan = buildSearchPlan({
    markets: ["SG", "CN", "HK"],
    roleFamilies: ["ai_engineering"],
    employmentTypes: ["internship", "full_time"],
  });

  assert.deepEqual([...new Set(plan.map((entry) => entry.market))].sort(), ["CN", "HK", "SG"]);
  for (const market of ["SG", "CN", "HK"]) {
    assert.ok(
      plan.some(
        (entry) =>
          entry.market === market &&
          getSourceById(entry.sourceId)?.listingSupport === "tested" &&
          entry.searchUrl.startsWith("https://"),
      ),
      `${market} should have at least one tested native reader`,
    );
  }
});

test("buildSearchPlan rejects unsupported markets", () => {
  assert.throws(
    () =>
      buildSearchPlan({
        markets: ["US"],
        roleFamilies: ["data"],
        employmentTypes: ["full_time"],
      }),
    /Unsupported market: US/,
  );
});

test("buildSearchPlan can use only explicitly approved dynamic role titles", () => {
  const plan = buildSearchPlan({
    markets: ["SG"],
    roleTitles: ["Applied Scientist", "AI Product Manager"],
    employmentTypes: ["full_time"],
  });

  assert.deepEqual([...new Set(plan.map((entry) => entry.roleTitle))].sort(), [
    "AI Product Manager",
    "Applied Scientist",
  ]);
  assert.equal(
    plan.some((entry) => /data analyst/iu.test(entry.query)),
    false,
  );
});

test("deduplicateJobs merges tracking variants and keeps richer evidence", () => {
  const jobs = deduplicateJobs([
    {
      id: "a",
      title: "Machine Learning Intern",
      company: "Fictional Labs",
      location: "Singapore",
      url: "https://example.test/jobs/42?utm_source=feed",
      description: "Short",
      source: "Board A",
    },
    {
      id: "b",
      title: "Machine Learning Intern",
      company: "Fictional Labs",
      location: "Singapore",
      url: "https://example.test/jobs/42?utm_campaign=autumn#apply",
      description: "A richer description with Python, SQL, and model evaluation.",
      source: "Board B",
    },
  ]);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].description, "A richer description with Python, SQL, and model evaluation.");
  assert.deepEqual(jobs[0].sources.sort(), ["Board A", "Board B"]);
});

test("deduplicateJobs uses normalized identity when a URL is unavailable", () => {
  const jobs = deduplicateJobs([
    {
      id: "a",
      title: "AI Product Intern",
      company: "Example Finance",
      location: "Hong Kong",
      source: "Import",
    },
    {
      id: "b",
      title: "  ai product intern ",
      company: "EXAMPLE FINANCE",
      location: "Hong-Kong",
      source: "Manual",
    },
  ]);

  assert.equal(jobs.length, 1);
});

test("deduplicateJobs keeps historical tracking state while merging fresher evidence", () => {
  const jobs = deduplicateJobs([
    {
      id: "historic-id",
      title: "Machine Learning Intern",
      company: "Fictional Labs",
      location: "Singapore",
      url: "https://example.test/jobs/42",
      status: "applied",
      statusUpdatedAt: "2026-09-05T10:00:00.000Z",
      firstSeenAt: "2026-09-01T08:00:00.000Z",
      description: "Short",
      source: "Previous CSV",
    },
    {
      id: "new-scan-id",
      title: "Machine Learning Intern",
      company: "Fictional Labs",
      location: "Singapore",
      url: "https://example.test/jobs/42?utm_source=scan",
      status: "new",
      firstSeenAt: "2026-09-06T08:00:00.000Z",
      lastSeenAt: "2026-09-06T08:00:00.000Z",
      description: "Detailed Python, SQL, LLM, and model evaluation requirements.",
      source: "Fresh scan",
    },
  ]);

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, "historic-id");
  assert.equal(jobs[0].status, "applied");
  assert.equal(jobs[0].statusUpdatedAt, "2026-09-05T10:00:00.000Z");
  assert.equal(jobs[0].firstSeenAt, "2026-09-01T08:00:00.000Z");
  assert.equal(jobs[0].lastSeenAt, "2026-09-06T08:00:00.000Z");
  assert.match(jobs[0].description, /Detailed Python/);
});

test("rankJob exposes a schedule mismatch without excluding a strong internship", () => {
  const ranked = rankJob(
    {
      title: "AI Engineering Intern",
      location: "Singapore",
      employmentType: "internship",
      skills: ["Python", "SQL", "LLM"],
      schedule: "full-time",
      postedAt: "2026-09-05",
      verification: "source_checked",
    },
    {
      markets: ["SG"],
      skills: ["python", "sql", "llm"],
      preferredSchedule: "part-time",
      now: "2026-09-06",
    },
  );

  assert.equal(ranked.excluded, false);
  assert.ok(ranked.score >= 70);
  assert.ok(ranked.flags.includes("schedule_mismatch"));
  assert.ok(ranked.reasons.includes("3 matching skills"));
});

test("job presentation separates field warnings from evidence-based fit levels", () => {
  assert.equal(typeof jobsDomain.assessJobPresentation, "function");
  const task = { roleTitle: "Data Analyst", query: "Data Analyst internship" };
  const strong = jobsDomain.assessJobPresentation(
    {
      title: "Data Science Intern",
      company: "Strides Digital",
      rawCompany: "Strides Digitalstridesdigital.com.sg",
      url: "https://example.com/strong",
      description: "Perform data mining, processing and cleansing with Python.",
      classification: "Science & Technology",
    },
    task,
  );
  assert.equal(strong.reviewStatus, "recommended");
  assert.equal(strong.fitLevel, "strong");
  assert.deepEqual(strong.dataWarnings, ["source_company_normalized"]);

  const adjacent = jobsDomain.assessJobPresentation(
    {
      title: "Market Research Analyst Intern",
      company: "Example Pte Ltd",
      url: "https://example.com/adjacent",
      description: "Research markets and report quantitative insights.",
    },
    task,
  );
  assert.equal(adjacent.reviewStatus, "recommended");
  assert.equal(adjacent.fitLevel, "adjacent");

  const broad = jobsDomain.assessJobPresentation(
    {
      title: "Marketing Intern",
      company: "Example Pte Ltd",
      url: "https://example.com/broad",
      description: "Plan social campaigns.",
    },
    task,
  );
  assert.equal(broad.reviewStatus, "recommended");
  assert.equal(broad.fitLevel, "broad");
  assert.deepEqual(broad.reviewReasons, []);

  const unresolved = jobsDomain.assessJobPresentation(
    {
      title: "Analytics GrabFood",
      company: "",
      rawCompany: "Internship",
      url: "https://example.com/unresolved",
      description: "Use operational insights and data analytics to improve decisions.",
    },
    task,
  );
  assert.equal(unresolved.fitLevel, "strong");
  assert.deepEqual(unresolved.dataWarnings, ["source_company_unresolved"]);
});

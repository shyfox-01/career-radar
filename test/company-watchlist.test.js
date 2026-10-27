import test from "node:test";
import assert from "node:assert/strict";

import { detectAtsFamily } from "../src/companies/ats.js";
import { normalizeCompanyRecord, upsertCompanyWatchlist } from "../src/companies/watchlist.js";

test("company name and market are sufficient for an unresolved watchlist record", () => {
  const company = normalizeCompanyRecord({
    name: " Fictional Bank ",
    markets: ["SG", "HK", "SG"],
  });
  assert.equal(company.name, "Fictional Bank");
  assert.equal(company.domain, null);
  assert.equal(company.careersUrl, null);
  assert.equal(company.officialDomainState, "unverified");
  assert.equal(company.atsFamily, "unresolved");
  assert.equal("priority" in company, false);
  assert.deepEqual(company.markets, ["SG", "HK"]);
});

test("optional careers URL must be public HTTPS and remains unverified", () => {
  assert.throws(
    () => normalizeCompanyRecord({ name: "Bad", careersUrl: "file:///tmp/jobs", markets: ["SG"] }),
    /public HTTPS/iu,
  );
  assert.throws(
    () =>
      normalizeCompanyRecord({
        name: "Local",
        careersUrl: "http://localhost:3000",
        markets: ["SG"],
      }),
    /public HTTPS/iu,
  );
  const candidate = normalizeCompanyRecord({
    name: "Fictional Group",
    careersUrl: "https://careers.fictional.example/jobs",
    markets: ["CN"],
  });
  assert.equal(candidate.domain, "https://careers.fictional.example/");
  assert.equal(candidate.careersUrl, "https://careers.fictional.example/jobs");
  assert.equal(candidate.officialDomainState, "unverified");
});

test("watchlist upsert merges company names and enriches an optional URL", () => {
  const first = upsertCompanyWatchlist([], { name: "Example Tech", markets: ["SG"] });
  const second = upsertCompanyWatchlist(first, {
    name: "example tech",
    careersUrl: "https://jobs.example.test/",
    markets: ["HK"],
  });
  assert.equal(second.length, 1);
  assert.equal(second[0].careersUrl, "https://jobs.example.test/");
  assert.deepEqual(second[0].markets.sort(), ["HK", "SG"]);
});

test("common public applicant tracking systems are detected without claiming verification", () => {
  assert.equal(detectAtsFamily("https://boards.greenhouse.io/example"), "greenhouse");
  assert.equal(detectAtsFamily("https://example.wd5.myworkdayjobs.com/Careers"), "workday");
  assert.equal(detectAtsFamily("https://jobs.lever.co/example"), "lever");
  assert.equal(detectAtsFamily("https://careers.example.test/jobs"), "generic");
});

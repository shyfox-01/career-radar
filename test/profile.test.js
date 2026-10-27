import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCareerPreferences } from "../src/domain/profile.js";

test("career preferences keep only lean student job-search fields", () => {
  const result = normalizeCareerPreferences({
    educationLevel: "  Master  ",
    school: "  Fictional University ",
    major: " Data Science ",
    graduationDate: "2026-12-15",
    internshipAvailableFrom: "2026-05-01",
    markets: ["SG", "SG", "HK"],
    industries: [" FinTech ", "fintech", "Healthcare"],
    roleInterests: ["ML Engineer", " AI Product Manager "],
    emphasizedSkills: ["Python", " python ", "SQL"],
    excludedWork: ["Pure reporting"],
    internshipWindows: [{ start: "2026-05-01", end: "2026-08-31" }],
    earliestFullTimeStart: "2027-01-01",
    workAuthorizationNote: " Student Pass ",
    careerNote: " Interested in applied AI. ",
    unrelatedSecret: "must not survive",
  });

  assert.deepEqual(result, {
    graduationDate: "2026-12-15",
    internshipAvailableFrom: "2026-05-01",
    markets: ["SG", "HK"],
    industries: ["FinTech", "Healthcare"],
    roleInterests: ["ML Engineer", "AI Product Manager"],
    emphasizedSkills: ["Python", "SQL"],
    excludedWork: ["Pure reporting"],
    careerNote: "Interested in applied AI.",
  });
  for (const removed of [
    "educationLevel",
    "school",
    "major",
    "internshipWindows",
    "earliestFullTimeStart",
    "workAuthorizationNote",
  ]) {
    assert.equal(removed in result, false);
  }
  assert.equal("unrelatedSecret" in result, false);
});

test("career preferences validate graduation and internship start dates", () => {
  assert.throws(
    () => normalizeCareerPreferences({ graduationDate: "2026-02-30" }),
    /graduationDate/u,
  );
  assert.throws(
    () => normalizeCareerPreferences({ internshipAvailableFrom: "2026-02-30" }),
    /internshipAvailableFrom/u,
  );
});

test("career preferences reject unsupported markets", () => {
  assert.throws(
    () => normalizeCareerPreferences({ markets: ["SG", "US"] }),
    /Unsupported market: US/u,
  );
});

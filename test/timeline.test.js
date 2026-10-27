import test from "node:test";
import assert from "node:assert/strict";

import { evaluateTimeline } from "../src/domain/timeline.js";

test("an internship starting before availability is advisory and keeps duration", () => {
  const result = evaluateTimeline(
    {
      employmentType: "internship",
      startDate: "2026-04-01",
      durationRequirement: "At least 6 months",
    },
    { internshipAvailableFrom: "2026-06-01" },
  );
  assert.equal(result.status, "advisory");
  assert.equal(result.durationLabel, "At least 6 months");
  assert.match(result.reasons.join(" "), /before/iu);
});

test("an internship starting after availability is eligible", () => {
  const result = evaluateTimeline(
    { employmentType: "internship", startDate: "2026-08-01", durationRequirement: "3 months" },
    { internshipAvailableFrom: "2026-06-01" },
  );
  assert.equal(result.status, "eligible");
  assert.equal(result.durationLabel, "3 months");
});

test("full-time start dates are never used to exclude a job", () => {
  const result = evaluateTimeline(
    { employmentType: "full_time", mandatoryStartDate: "2026-09-01" },
    { earliestFullTimeStart: "2027-01-01" },
  );
  assert.equal(result.status, "date_unknown");
  assert.equal(
    result.reasons.some((reason) => /earliest/iu.test(reason)),
    false,
  );
});

test("missing or ambiguous job dates remain visible as date unknown", () => {
  assert.equal(
    evaluateTimeline({ employmentType: "internship" }, { internshipAvailableFrom: "2026-06-01" })
      .status,
    "date_unknown",
  );
});

test("weekly attendance and flexibility never create a timeline exclusion", () => {
  const result = evaluateTimeline(
    {
      employmentType: "internship",
      startDate: "2026-07-01",
      durationRequirement: "6 months",
      daysPerWeek: 5,
      flexible: false,
    },
    {
      internshipAvailableFrom: "2026-06-01",
      preferredDaysPerWeek: 2,
    },
  );
  assert.equal(result.status, "eligible");
  assert.equal(
    result.reasons.some((reason) => /week|flex/iu.test(reason)),
    false,
  );
  assert.equal(result.durationLabel, "6 months");
});

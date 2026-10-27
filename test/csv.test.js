import test from "node:test";
import assert from "node:assert/strict";

import { jobSnapshotFromCsv, jobsFromCsv, jobsToCsv } from "../src/domain/csv.js";

test("CSV snapshots round-trip quoted fields and lifecycle metadata", () => {
  const csv = jobsToCsv(
    [
      {
        id: "historic-1",
        title: "Data, AI Intern",
        company: 'Fictional "Harbour"',
        location: "Singapore",
        employmentType: "internship",
        status: "applied",
        statusUpdatedAt: "2026-09-05T10:00:00.000Z",
        firstSeenAt: "2026-09-01T08:00:00.000Z",
        lastSeenAt: "2026-09-05T08:00:00.000Z",
        postedAt: "2026-08-30",
        score: 82,
        source: "Example Board",
        verification: "source_checked",
        url: "https://example.test/jobs/1",
      },
    ],
    { lastDiscoveryAt: "2026-09-05T12:00:00.000Z" },
  );

  const snapshot = jobSnapshotFromCsv(`\uFEFF${csv}`);
  const jobs = snapshot.jobs;

  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], {
    id: "historic-1",
    title: "Data, AI Intern",
    company: 'Fictional "Harbour"',
    location: "Singapore",
    employmentType: "internship",
    status: "applied",
    statusUpdatedAt: "2026-09-05T10:00:00.000Z",
    firstSeenAt: "2026-09-01T08:00:00.000Z",
    lastSeenAt: "2026-09-05T08:00:00.000Z",
    postedAt: "2026-08-30",
    score: 82,
    source: "Example Board",
    verification: "source_checked",
    url: "https://example.test/jobs/1",
  });
  assert.equal(snapshot.lastDiscoveryAt, "2026-09-05T12:00:00.000Z");
});

test("CSV import accepts the version 0.1 export columns", () => {
  const jobs = jobsFromCsv(
    "id,title,company,location,employmentType,status,score,source,url\r\n" +
      'old-1,"ML Intern","Fictional Co","Hong Kong",internship,saved,74,Legacy,https://example.test/old-1',
  );

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, "old-1");
  assert.equal(jobs[0].status, "saved");
  assert.equal(jobs[0].score, 74);
});

test("CSV import rejects files that are not Career Radar job snapshots", () => {
  assert.throws(
    () => jobsFromCsv("name,email\nCandidate,candidate@example.test"),
    /CSV must include title and company columns/,
  );
});

test("CSV export neutralizes formulas and import restores the literal text", () => {
  const csv = jobsToCsv([{ id: "1", title: "=1+1", company: "Fictional" }]);
  assert.match(csv, /"'=1\+1"/);
  assert.equal(jobsFromCsv(csv)[0].title, "=1+1");
});

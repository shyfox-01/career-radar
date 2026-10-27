import test from "node:test";
import assert from "node:assert/strict";

import { auditRowsToCsv, importJobsWithAudit } from "../src/domain/import-audit.js";

test("mixed CSV rows are accepted, normalized, merged, quarantined, and audited", () => {
  const csv = [
    "title,company,location,employmentType,status,score,url,legacyNote",
    "Data Intern,Fictional One,Singapore,internship,new,70,https://example.test/jobs/1,keep elsewhere",
    " AI Intern , Fictional Two ,Hong Kong,Intern,已投递,82,https://example.test/jobs/2,old",
    "AI Intern,Fictional Two,Hong Kong,internship,applied,82,https://example.test/jobs/2?utm_source=feed,duplicate",
    ",Missing Title,Singapore,internship,new,50,https://example.test/jobs/3,bad",
  ].join("\r\n");

  const result = importJobsWithAudit(csv);

  assert.equal(result.snapshot.jobs.length, 2);
  assert.deepEqual(result.summary, {
    accepted: 1,
    normalized: 1,
    merged: 1,
    quarantined: 1,
    ignoredColumns: 1,
    totalRows: 4,
  });
  assert.equal(result.snapshot.jobs.find((job) => job.title === "AI Intern").status, "applied");
  assert.ok(
    result.auditRows.some((row) => row.action === "ignored_column" && row.field === "legacyNote"),
  );
  assert.ok(result.auditRows.some((row) => row.action === "quarantined" && row.rowNumber === 5));
  assert.ok(result.auditRows.some((row) => row.action === "merged" && row.rowNumber === 4));
});

test("audit CSV neutralizes spreadsheet formulas", () => {
  const csv = auditRowsToCsv([
    {
      rowNumber: 2,
      field: "title",
      action: "normalized",
      reasonCode: "trimmed",
      originalValue: "=1+1",
      resultingValue: "safe",
    },
  ]);
  assert.match(csv, /"'=1\+1"/u);
});

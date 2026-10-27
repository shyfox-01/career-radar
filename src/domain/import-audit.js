import {
  IMPORTABLE_JOB_COLUMNS,
  SNAPSHOT_DISCOVERY_COLUMN,
  parseCsvRows,
  restoreSpreadsheetLiteral,
} from "./csv.js";

const STATUS_ALIASES = Object.freeze({
  new: "new",
  新职位: "new",
  viewed: "viewed",
  已查看: "viewed",
  saved: "saved",
  已收藏: "saved",
  applied: "applied",
  已投递: "applied",
  interview: "interview",
  面试中: "interview",
  offer: "offer",
  rejected: "rejected",
  未通过: "rejected",
});
const EMPLOYMENT_ALIASES = Object.freeze({
  internship: "internship",
  intern: "internship",
  实习: "internship",
  full_time: "full_time",
  "full-time": "full_time",
  fulltime: "full_time",
  全职: "full_time",
  正式岗: "full_time",
});
const AUDIT_COLUMNS = Object.freeze([
  "rowNumber",
  "field",
  "action",
  "reasonCode",
  "originalValue",
  "resultingValue",
]);

function auditCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function normalizedKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function canonicalUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|source|campaign|tracking)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

function identity(job) {
  const url = canonicalUrl(job.url);
  if (url) return `url:${url}`;
  return `sig:${[job.title, job.company, job.location].map(normalizedKey).join(":")}`;
}

function addAudit(
  rows,
  rowNumber,
  field,
  action,
  reasonCode,
  originalValue = "",
  resultingValue = "",
) {
  rows.push({ rowNumber, field, action, reasonCode, originalValue, resultingValue });
}

function cleanText(value) {
  return restoreSpreadsheetLiteral(String(value ?? ""))
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
}

function normalizeRow(values, headers, rowNumber, auditRows) {
  const record = {};
  let changed = false;
  for (const field of IMPORTABLE_JOB_COLUMNS) {
    const index = headers.indexOf(field);
    if (index < 0 || values[index] == null || values[index] === "") continue;
    const original = restoreSpreadsheetLiteral(values[index]);
    let value = cleanText(values[index]);
    if (field === "score") {
      const score = Number(value);
      if (!Number.isFinite(score)) {
        addAudit(auditRows, rowNumber, field, "quarantined", "invalid_score", original, "");
        return { quarantined: true };
      }
      value = score;
    } else if (field === "status") {
      const status = STATUS_ALIASES[value.toLocaleLowerCase("en")] ?? STATUS_ALIASES[value];
      if (!status) {
        addAudit(auditRows, rowNumber, field, "quarantined", "unsupported_status", original, "");
        return { quarantined: true };
      }
      value = status;
    } else if (field === "employmentType") {
      value =
        EMPLOYMENT_ALIASES[value.toLocaleLowerCase("en")] ?? EMPLOYMENT_ALIASES[value] ?? value;
    } else if (field === "url") {
      const canonical = canonicalUrl(value);
      if (!canonical) {
        addAudit(auditRows, rowNumber, field, "normalized", "invalid_url_dropped", original, "");
        changed = true;
        continue;
      }
      value = canonical;
    }
    if (String(value) !== original) {
      addAudit(
        auditRows,
        rowNumber,
        field,
        "normalized",
        field === "url" ? "canonical_url" : "normalized_value",
        original,
        value,
      );
      changed = true;
    }
    record[field] = value;
  }
  if (!record.title || !record.company) {
    addAudit(
      auditRows,
      rowNumber,
      !record.title ? "title" : "company",
      "quarantined",
      "missing_core_identity",
      !record.title ? record.title : record.company,
      "",
    );
    return { quarantined: true };
  }
  return { record, changed };
}

export function importJobsWithAudit(csv) {
  const rows = parseCsvRows(csv);
  if (!rows.length) throw new TypeError("CSV is empty");
  const headers = rows[0].map((header) => cleanText(header));
  if (!headers.includes("title") || !headers.includes("company")) {
    throw new TypeError("CSV must include title and company columns");
  }
  const auditRows = [];
  const allowed = new Set([...IMPORTABLE_JOB_COLUMNS, SNAPSHOT_DISCOVERY_COLUMN]);
  const unsupported = [...new Set(headers.filter((header) => header && !allowed.has(header)))];
  for (const field of unsupported)
    addAudit(auditRows, 1, field, "ignored_column", "unsupported_column", field, "");

  const jobsByIdentity = new Map();
  const summary = {
    accepted: 0,
    normalized: 0,
    merged: 0,
    quarantined: 0,
    ignoredColumns: unsupported.length,
    totalRows: rows.length - 1,
  };
  let lastDiscoveryAt = null;
  const snapshotIndex = headers.indexOf(SNAPSHOT_DISCOVERY_COLUMN);

  for (let index = 1; index < rows.length; index += 1) {
    const rowNumber = index + 1;
    for (const field of unsupported) {
      const columnIndex = headers.indexOf(field);
      const originalValue = rows[index][columnIndex] ?? "";
      if (originalValue !== "") {
        addAudit(
          auditRows,
          rowNumber,
          field,
          "ignored_column",
          "unsupported_column_value",
          originalValue,
          "",
        );
      }
    }
    const result = normalizeRow(rows[index], headers, rowNumber, auditRows);
    if (result.quarantined) {
      summary.quarantined += 1;
      continue;
    }
    const key = identity(result.record);
    if (jobsByIdentity.has(key)) {
      const previous = jobsByIdentity.get(key);
      jobsByIdentity.set(key, {
        ...previous,
        ...result.record,
        id: previous.id ?? result.record.id,
        status: previous.status !== "new" ? previous.status : result.record.status,
      });
      addAudit(auditRows, rowNumber, "row", "merged", "duplicate_identity", key, key);
      summary.merged += 1;
    } else {
      jobsByIdentity.set(key, result.record);
      if (result.changed) summary.normalized += 1;
      else summary.accepted += 1;
    }
    const snapshotValue = snapshotIndex >= 0 ? cleanText(rows[index][snapshotIndex]) : "";
    if (
      snapshotValue &&
      Number.isFinite(Date.parse(snapshotValue)) &&
      (!lastDiscoveryAt || Date.parse(snapshotValue) > Date.parse(lastDiscoveryAt))
    ) {
      lastDiscoveryAt = snapshotValue;
    }
  }

  return { snapshot: { jobs: [...jobsByIdentity.values()], lastDiscoveryAt }, auditRows, summary };
}

export function auditRowsToCsv(rows) {
  if (!Array.isArray(rows)) throw new TypeError("Audit rows must be an array");
  return [
    AUDIT_COLUMNS.join(","),
    ...rows.map((row) => AUDIT_COLUMNS.map((column) => auditCell(row[column])).join(",")),
  ].join("\r\n");
}

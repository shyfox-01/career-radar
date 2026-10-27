const JOB_COLUMNS = Object.freeze([
  "id",
  "title",
  "company",
  "location",
  "employmentType",
  "status",
  "score",
  "source",
  "url",
  "statusUpdatedAt",
  "firstSeenAt",
  "lastSeenAt",
  "postedAt",
  "verification",
]);
const SNAPSHOT_COLUMN = "snapshotLastDiscoveryAt";
const COLUMNS = Object.freeze([...JOB_COLUMNS, SNAPSHOT_COLUMN]);

function csvCell(value) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function parseCsvRows(input) {
  const text = String(input).replace(/^\uFEFF/u, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      if (cell.length > 0) throw new TypeError("Malformed quoted CSV cell");
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/u, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new TypeError("CSV contains an unclosed quoted cell");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell.replace(/\r$/u, ""));
    rows.push(row);
  }
  return rows.filter((candidate) => candidate.some((value) => value !== ""));
}

export function restoreSpreadsheetLiteral(value) {
  return /^'[=+\-@]/u.test(value) ? value.slice(1) : value;
}

export function jobsToCsv(jobs, { lastDiscoveryAt } = {}) {
  if (!Array.isArray(jobs)) throw new TypeError("jobs must be an array");
  return [
    COLUMNS.join(","),
    ...jobs.map((job) =>
      COLUMNS.map((column) =>
        csvCell(column === SNAPSHOT_COLUMN ? lastDiscoveryAt : job[column]),
      ).join(","),
    ),
  ].join("\r\n");
}

export function jobSnapshotFromCsv(csv) {
  const rows = parseCsvRows(csv);
  if (rows.length === 0) throw new TypeError("CSV is empty");
  const headers = rows[0].map((header) => header.trim());
  if (!headers.includes("title") || !headers.includes("company")) {
    throw new TypeError("CSV must include title and company columns");
  }

  let lastDiscoveryAt;
  const jobs = rows.slice(1).map((values, rowIndex) => {
    const record = {};
    for (const column of JOB_COLUMNS) {
      const index = headers.indexOf(column);
      if (index < 0 || values[index] == null || values[index] === "") continue;
      const value = restoreSpreadsheetLiteral(values[index]);
      record[column] = column === "score" ? Number(value) : value;
    }
    if (!record.title || !record.company) {
      throw new TypeError(`CSV row ${rowIndex + 2} needs a title and company`);
    }
    if (record.score != null && !Number.isFinite(record.score)) {
      throw new TypeError(`CSV row ${rowIndex + 2} has an invalid score`);
    }
    const snapshotIndex = headers.indexOf(SNAPSHOT_COLUMN);
    const snapshotValue = snapshotIndex >= 0 ? values[snapshotIndex] : "";
    if (snapshotValue) {
      if (!Number.isFinite(Date.parse(snapshotValue))) {
        throw new TypeError(`CSV row ${rowIndex + 2} has an invalid discovery timestamp`);
      }
      if (!lastDiscoveryAt || Date.parse(snapshotValue) > Date.parse(lastDiscoveryAt)) {
        lastDiscoveryAt = snapshotValue;
      }
    }
    return record;
  });
  return { jobs, lastDiscoveryAt: lastDiscoveryAt ?? null };
}

export function jobsFromCsv(csv) {
  return jobSnapshotFromCsv(csv).jobs;
}

export const JOB_CSV_COLUMNS = COLUMNS;
export const IMPORTABLE_JOB_COLUMNS = JOB_COLUMNS;
export const SNAPSHOT_DISCOVERY_COLUMN = SNAPSHOT_COLUMN;

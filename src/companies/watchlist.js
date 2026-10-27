import { detectAtsFamily } from "./ats.js";
import { createHash } from "node:crypto";

const MARKETS = new Set(["SG", "CN", "HK"]);

function parsePublicUrl(value, label) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/iu.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new TypeError(`${label} must be a public HTTPS URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new TypeError(`${label} must be a public HTTPS URL`);
  }
  const hostname = url.hostname.toLocaleLowerCase("en").replace(/\.$/u, "");
  if (
    !hostname.includes(".") ||
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    /^(?:127\.|10\.|192\.168\.|169\.254\.)/u.test(hostname)
  ) {
    throw new TypeError(`${label} must be a public HTTPS URL`);
  }
  url.hostname = hostname;
  url.hash = "";
  return url;
}

function companyId(name) {
  const key = name.normalize("NFKC").toLocaleLowerCase("en");
  const slug =
    key
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 48) || "company";
  const digest = createHash("sha256").update(key).digest("hex").slice(0, 8);
  return `company-${slug}-${digest}`;
}

function cleanMarkets(values) {
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (!MARKETS.has(value)) throw new RangeError(`Unsupported market: ${value}`);
    if (!result.includes(value)) result.push(value);
  }
  if (!result.length) throw new TypeError("At least one company market is required");
  return result;
}

export function normalizeCompanyRecord(input = {}) {
  const name = String(input.name ?? "")
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim();
  if (!name || name.length > 120 || /[<>\u0000-\u001F\u007F]/u.test(name))
    throw new TypeError("A safe company name is required");
  const careers = parsePublicUrl(input.careersUrl, "Careers URL");
  return {
    id: companyId(name),
    name,
    domain: careers ? `${careers.origin}/` : null,
    careersUrl: careers?.href ?? null,
    markets: cleanMarkets(input.markets),
    officialDomainState: "unverified",
    atsFamily: careers ? detectAtsFamily(careers.href) : "unresolved",
  };
}

export function upsertCompanyWatchlist(existing, input) {
  if (!Array.isArray(existing)) throw new TypeError("Company watchlist must be an array");
  const next = normalizeCompanyRecord(input);
  const index = existing.findIndex(
    (company) =>
      company.id === next.id ||
      company.name.toLocaleLowerCase("en") === next.name.toLocaleLowerCase("en"),
  );
  const output = existing.map((company) => ({ ...company }));
  if (index < 0) output.push(next);
  else {
    const previous = output[index];
    output[index] = {
      ...previous,
      ...next,
      id: previous.id,
      domain: next.domain ?? previous.domain ?? null,
      careersUrl: next.careersUrl ?? previous.careersUrl ?? null,
      atsFamily: next.careersUrl ? next.atsFamily : (previous.atsFamily ?? "unresolved"),
      markets: [...new Set([...previous.markets, ...next.markets])],
    };
  }
  return output.sort((left, right) => left.name.localeCompare(right.name, "en"));
}

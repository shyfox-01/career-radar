const AUTHENTICATION_STATES = new Set([
  "signed_in",
  "signed_out",
  "challenge",
  "unknown",
  "not_required",
]);
const EXTRACTION_STATES = new Set(["ready", "blocked", "unsupported", "unknown"]);

export class SourceAdapterError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SourceAdapterError";
    this.code = code;
    this.details = details;
  }
}

export function validateCapability(value) {
  if (!value || !AUTHENTICATION_STATES.has(value.authentication)) {
    throw new TypeError("Adapter capability has an invalid authentication state");
  }
  if (!EXTRACTION_STATES.has(value.extraction)) {
    throw new TypeError("Adapter capability has an invalid extraction state");
  }
  if (!Number.isInteger(value.resultCount) || value.resultCount < 0) {
    throw new TypeError("Adapter capability resultCount must be a non-negative integer");
  }
  return Object.freeze({
    authentication: value.authentication,
    extraction: value.extraction,
    page: typeof value.page === "string" ? value.page : "unknown",
    resultCount: value.resultCount,
    reason: typeof value.reason === "string" && value.reason ? value.reason : null,
  });
}

export function validateSourceAdapter(adapter) {
  if (!adapter || typeof adapter.id !== "string" || !adapter.id) {
    throw new TypeError("Source adapter needs an id");
  }
  if (!Array.isArray(adapter.sourceIds) || !adapter.sourceIds.length) {
    throw new TypeError(`${adapter.id} adapter needs sourceIds`);
  }
  if (typeof adapter.probe !== "function" || typeof adapter.discover !== "function") {
    throw new TypeError(`${adapter.id} adapter needs probe and discover methods`);
  }
  if (adapter.navigationHosts !== undefined) {
    if (!Array.isArray(adapter.navigationHosts)) {
      throw new TypeError(`${adapter.id} adapter navigationHosts must be an array`);
    }
    for (const host of adapter.navigationHosts) {
      if (
        typeof host !== "string" ||
        !host ||
        host !== host.toLocaleLowerCase("en") ||
        host.includes(":") ||
        host.includes("/")
      ) {
        throw new TypeError(
          `${adapter.id} adapter navigationHosts must contain lowercase hostnames`,
        );
      }
    }
  }
  return adapter;
}

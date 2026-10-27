import { SOURCE_CATALOG, getSourceById } from "./catalog.js";

const CONNECTION_STATES = new Set([
  "not_connected",
  "connected_unverified",
  "connected",
  "expired",
  "needs_repair",
  "desktop_required",
]);

function timestampOrNull(value) {
  if (typeof value !== "string") return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

function failureOrNull(value) {
  if (!value || typeof value !== "object") return null;
  if (typeof value.code !== "string" || typeof value.message !== "string") return null;
  return { code: value.code, message: value.message };
}

export function getLoginSource(sourceId) {
  const source = getSourceById(sourceId);
  if (!source) throw new RangeError(`Unknown source: ${sourceId}`);
  if (source.access !== "login" && !source.adapterId)
    throw new TypeError(`${source.name} does not require login`);
  return source;
}

export function sourceConnectionView(source, metadata = {}, desktopAvailable = true) {
  if (!source || (source.access !== "login" && !source.adapterId)) {
    throw new TypeError(`${source?.name ?? "Source"} does not require login`);
  }
  const requestedState = desktopAvailable
    ? (metadata.state ?? "not_connected")
    : "desktop_required";
  const state = CONNECTION_STATES.has(requestedState) ? requestedState : "not_connected";
  return {
    sourceId: source.id,
    name: source.name,
    market: source.market,
    state,
    desktopAvailable,
    extractionCapability: source.extractionCapability ?? "assisted_only",
    adapterId: metadata.adapterId ?? source.adapterId ?? null,
    authentication: metadata.authentication ?? "unknown",
    extraction: metadata.extraction ?? (source.adapterId ? "unknown" : "unsupported"),
    lastProbedAt: timestampOrNull(metadata.lastProbedAt),
    probeResultCount:
      Number.isInteger(metadata.probeResultCount) && metadata.probeResultCount >= 0
        ? metadata.probeResultCount
        : null,
    scan: metadata.scan ?? null,
    lastSuccessfulExtractionAt: timestampOrNull(metadata.lastSuccessfulExtractionAt),
    lastFailure: failureOrNull(metadata.lastFailure),
    lastConfirmedAt: timestampOrNull(metadata.lastConfirmedAt),
    lastOpenedAt: timestampOrNull(metadata.lastOpenedAt),
  };
}

export function createUnavailableSourceSessionController() {
  const unavailable = async () => {
    const error = new TypeError("Source login connections require the packaged desktop app");
    error.code = "desktop_required";
    throw error;
  };
  return Object.freeze({
    async list() {
      return SOURCE_CATALOG.filter((source) => source.access === "login" || source.adapterId).map(
        (source) => sourceConnectionView(source, {}, false),
      );
    },
    connect: unavailable,
    confirm: unavailable,
    probe: unavailable,
    discover: unavailable,
    open: unavailable,
    disconnect: unavailable,
  });
}

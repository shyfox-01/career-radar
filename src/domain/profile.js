const SUPPORTED_MARKETS = new Set(["SG", "CN", "HK"]);

function cleanText(value, name, maxLength = 500) {
  if (value == null) return "";
  if (typeof value !== "string") throw new TypeError(`${name} must be a string`);
  const text = value.trim().replace(/\s+/gu, " ");
  if (text.length > maxLength) throw new RangeError(`${name} is too long`);
  return text;
}

function cleanList(value, name, maxItems = 30) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`);
  if (value.length > maxItems) throw new RangeError(`${name} has too many items`);
  const seen = new Set();
  const result = [];
  for (const item of value) {
    const text = cleanText(item, `${name} item`, 200);
    if (!text) continue;
    const key = text.normalize("NFKC").toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function cleanDate(value, name) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new TypeError(`${name} must use YYYY-MM-DD`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new TypeError(`${name} is not a valid date`);
  }
  return value;
}

export function normalizeCareerPreferences(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("career preferences must be an object");
  }
  const markets = cleanList(input.markets, "markets", 3).map((market) => market.toUpperCase());
  for (const market of markets) {
    if (!SUPPORTED_MARKETS.has(market)) {
      throw new RangeError(`Unsupported market: ${market}`);
    }
  }
  return {
    graduationDate: cleanDate(input.graduationDate, "graduationDate"),
    internshipAvailableFrom: cleanDate(input.internshipAvailableFrom, "internshipAvailableFrom"),
    markets,
    industries: cleanList(input.industries, "industries"),
    roleInterests: cleanList(input.roleInterests, "roleInterests"),
    emphasizedSkills: cleanList(input.emphasizedSkills, "emphasizedSkills"),
    excludedWork: cleanList(input.excludedWork, "excludedWork"),
    careerNote: cleanText(input.careerNote, "careerNote", 4000),
  };
}

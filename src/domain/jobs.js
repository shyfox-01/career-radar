import { EMPLOYMENT_TERMS, MARKETS, ROLE_FAMILIES } from "./regions.js";
import { getMarketSources, getSourceById } from "../sources/catalog.js";
import { localizeRoleTerm } from "./roles.js";

function requireNonemptyArray(value, name) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty array`);
  }
}

export function buildSearchPlan(criteria) {
  const { markets, roleFamilies, roleTitles, employmentTypes, selectedSourceIds } = criteria ?? {};
  requireNonemptyArray(markets, "markets");
  if (
    (!Array.isArray(roleTitles) || roleTitles.length === 0) &&
    (!Array.isArray(roleFamilies) || roleFamilies.length === 0)
  ) {
    throw new TypeError("roleTitles or roleFamilies must be a non-empty array");
  }
  requireNonemptyArray(employmentTypes, "employmentTypes");
  if (selectedSourceIds != null && !Array.isArray(selectedSourceIds)) {
    throw new TypeError("selectedSourceIds must be an array");
  }
  for (const sourceId of selectedSourceIds ?? []) {
    const source = getSourceById(sourceId);
    if (!source) throw new RangeError(`Unsupported source: ${sourceId}`);
    if (!markets.includes(source.market))
      throw new RangeError(`Source ${sourceId} does not belong to a selected market`);
  }

  const plan = [];
  for (const market of markets) {
    const marketConfig = MARKETS[market];
    if (!marketConfig) throw new RangeError(`Unsupported market: ${market}`);
    const marketSources = selectedSourceIds?.length
      ? selectedSourceIds.map(getSourceById).filter((source) => source.market === market)
      : getMarketSources(market).filter((source) => source.defaultEnabled);
    if (!marketSources.length)
      throw new TypeError(`At least one source must be selected for ${market}`);

    const roleEntries =
      Array.isArray(roleTitles) && roleTitles.length
        ? roleTitles.map((title) => ({ roleFamily: "dynamic", roleTitle: title, terms: [title] }))
        : roleFamilies.map((roleFamily) => {
            const roleConfig = ROLE_FAMILIES[roleFamily];
            if (!roleConfig) throw new RangeError(`Unsupported role family: ${roleFamily}`);
            return { roleFamily, roleTitle: null, terms: roleConfig.terms[market] };
          });

    for (const roleEntry of roleEntries) {
      const { roleFamily, roleTitle } = roleEntry;

      for (const employmentType of employmentTypes) {
        const employmentTerm = EMPLOYMENT_TERMS[employmentType]?.[market];
        if (!employmentTerm) {
          throw new RangeError(`Unsupported employment type: ${employmentType}`);
        }

        for (const roleTerm of roleEntry.terms) {
          const query = `${localizeRoleTerm(roleTerm, market)} ${employmentTerm}`;
          for (const provider of marketSources) {
            plan.push({
              id: `${market}:${provider.id}:${roleFamily}:${employmentType}:${roleTerm}`,
              market,
              marketLabel: marketConfig.label,
              provider: provider.name,
              sourceId: provider.id,
              sourceType: provider.type,
              roleFamily,
              roleTitle,
              employmentType,
              query,
              access: provider.access,
              searchUrl: provider.searchUrl(query),
              sourceEvidence: provider.freshnessEvidence,
              status: "not_checked",
            });
          }
        }
      }
    }
  }
  return plan;
}

function normalizeIdentityPart(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function canonicalUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|source|campaign|tracking)$/iu.test(key)) {
        url.searchParams.delete(key);
      }
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
  return `sig:${[job.company, job.title, job.location].map(normalizeIdentityPart).join(":")}`;
}

function richness(job) {
  return [job.description, job.requirements, job.skills]
    .flatMap((value) => (Array.isArray(value) ? value : [value ?? ""]))
    .join(" ").length;
}

function latestTimestamp(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime)) return right;
  if (!Number.isFinite(rightTime)) return left;
  return rightTime > leftTime ? right : left;
}

function earlierTimestamp(left, right) {
  if (!left) return right;
  if (!right) return left;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime)) return right;
  if (!Number.isFinite(rightTime)) return left;
  return rightTime < leftTime ? right : left;
}

export function deduplicateJobs(jobs) {
  if (!Array.isArray(jobs)) throw new TypeError("jobs must be an array");
  const byIdentity = new Map();

  for (const job of jobs) {
    const key = identity(job);
    const previous = byIdentity.get(key);
    if (!previous) {
      byIdentity.set(key, {
        ...job,
        url: canonicalUrl(job.url) ?? job.url,
        sources: job.source ? [job.source] : [],
        sourceTaskIds: [
          ...new Set([...(job.sourceTaskIds ?? []), job.sourceTaskId].filter(Boolean)),
        ],
      });
      continue;
    }

    const richer = richness(job) > richness(previous) ? job : previous;
    const tracked =
      previous.status && previous.status !== "new"
        ? previous
        : job.status && job.status !== "new"
          ? job
          : previous.status
            ? previous
            : job;
    byIdentity.set(key, {
      ...previous,
      ...richer,
      id: previous.id ?? richer.id,
      status: tracked.status ?? "new",
      statusUpdatedAt: tracked.statusUpdatedAt,
      importedAt: earlierTimestamp(previous.importedAt, job.importedAt),
      firstSeenAt: earlierTimestamp(previous.firstSeenAt, job.firstSeenAt),
      lastSeenAt: latestTimestamp(previous.lastSeenAt, job.lastSeenAt),
      url: canonicalUrl(richer.url) ?? richer.url ?? previous.url,
      sources: [...new Set([...previous.sources, job.source].filter(Boolean))],
      sourceTaskIds: [
        ...new Set(
          [
            ...(previous.sourceTaskIds ?? []),
            ...(job.sourceTaskIds ?? []),
            job.sourceTaskId,
          ].filter(Boolean),
        ),
      ],
    });
  }

  return [...byIdentity.values()];
}

function marketFromLocation(location = "") {
  const normalized = normalizeIdentityPart(location);
  if (/singapore|新加坡/u.test(normalized)) return "SG";
  if (/hongkong|香港/u.test(normalized)) return "HK";
  if (/china|中国|上海|深圳|北京|广州|杭州/u.test(normalized)) return "CN";
  return null;
}

const FIT_CLUSTERS = [
  {
    target: /\bdata\b.{0,12}\banaly(?:st|tic)|\banaly(?:st|tic).{0,12}\bdata\b/iu,
    strong:
      /\bdata\b|analytics?|business intelligence|\bbi\b|machine learning|\bml\b|artificial intelligence|\bai\b|actuarial|\bsql\b|\bpython\b|dashboard|data mining|data (?:processing|cleansing|transformation)|statistics/iu,
    adjacent:
      /\banaly(?:sis|st)\b|research|insights?|reporting|strategy|portfolio|financial|investment|quantitative|operations?/iu,
  },
  {
    target: /machine learning|artificial intelligence|\bai\b|\bml\b|data scientist/iu,
    strong:
      /machine learning|artificial intelligence|\bai\b|\bml\b|data scien|deep learning|nlp|computer vision|model(?:ing|ling)?/iu,
    adjacent: /\bdata\b|analytics?|software|research|statistics|\bpython\b/iu,
  },
  {
    target: /\bproduct\b/iu,
    strong: /\bproduct\b|product owner|roadmap|user research|product strategy/iu,
    adjacent: /business analyst|project management|operations|strategy|customer experience/iu,
  },
  {
    target: /software|developer|engineer/iu,
    strong:
      /software|developer|engineer|backend|front.?end|full.?stack|programming|application development/iu,
    adjacent: /technical|automation|\bdata\b|cloud|platform/iu,
  },
  {
    target: /finance|financial|investment|risk|quant|trading|portfolio/iu,
    strong:
      /finance|financial|investment|risk|quant|trading|portfolio|markets?|banking|asset management/iu,
    adjacent: /analytics?|research|strategy|actuarial|economics/iu,
  },
];

export function assessJobPresentation(job, task) {
  const reviewReasons = [];
  if (!String(job?.title ?? "").trim() || !String(job?.url ?? "").trim())
    reviewReasons.push("critical_field_missing");
  const dataWarnings = [...new Set(job?.sourceFieldWarnings ?? [])];
  const company = String(job?.company ?? "").trim();
  const rawCompany = String(job?.rawCompany ?? "").trim();
  if (rawCompany && rawCompany !== company && !dataWarnings.length)
    dataWarnings.push(company ? "source_company_normalized" : "source_company_unresolved");
  const target = String(task?.roleTitle ?? task?.query ?? "").trim();
  const title = String(job?.title ?? "");
  const supporting = [
    job?.description,
    job?.classification,
    job?.subClassification,
    ...(job?.skills ?? []),
  ]
    .filter(Boolean)
    .join(" ");
  const evidence = `${title} ${supporting}`;
  const cluster = target && FIT_CLUSTERS.find((entry) => entry.target.test(target));
  let fitLevel = "broad",
    fitReasons = ["limited_role_evidence"];
  if (cluster?.strong?.test(title)) {
    fitLevel = "strong";
    fitReasons = ["title_role_evidence"];
  } else if (cluster?.strong?.test(supporting)) {
    fitLevel = "strong";
    fitReasons = ["description_skill_evidence"];
  } else if (cluster?.adjacent?.test(evidence)) {
    fitLevel = "adjacent";
    fitReasons = ["adjacent_role_evidence"];
  } else if (!cluster && target) {
    const tokens = target.toLocaleLowerCase("en").match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    const hits = tokens.filter((token) => evidence.toLocaleLowerCase("en").includes(token)).length;
    if (hits >= Math.max(1, Math.ceil(tokens.length * 0.6))) {
      fitLevel = "strong";
      fitReasons = ["title_role_evidence"];
    } else if (hits) {
      fitLevel = "adjacent";
      fitReasons = ["adjacent_role_evidence"];
    }
  }
  return {
    reviewStatus: reviewReasons.length ? "needs_review" : "recommended",
    reviewReasons,
    fitLevel,
    fitReasons,
    dataWarnings,
  };
}

export function assessJobForReview(job, task) {
  const result = assessJobPresentation(job, task);
  return { status: result.reviewStatus, reasons: result.reviewReasons };
}

export function rankJob(job, profile) {
  const wantedSkills = new Set((profile.skills ?? []).map(normalizeIdentityPart));
  const matchedSkills = (job.skills ?? []).filter((skill) =>
    wantedSkills.has(normalizeIdentityPart(skill)),
  );
  const reasons = [];
  const flags = [];
  let score = 40 + Math.min(matchedSkills.length * 12, 36);

  if (matchedSkills.length > 0) {
    reasons.push(`${matchedSkills.length} matching skills`);
  }
  if ((profile.markets ?? []).includes(marketFromLocation(job.location))) {
    score += 10;
    reasons.push("target market");
  }
  if (job.verification === "source_checked") {
    score += 8;
    reasons.push("source checked");
  }

  if (job.postedAt && profile.now) {
    const ageDays = Math.floor((Date.parse(profile.now) - Date.parse(job.postedAt)) / 86_400_000);
    if (Number.isFinite(ageDays) && ageDays <= 7) {
      score += 8;
      reasons.push("recently posted");
    }
  }

  if (
    profile.preferredSchedule &&
    job.schedule &&
    normalizeIdentityPart(profile.preferredSchedule) !== normalizeIdentityPart(job.schedule)
  ) {
    score -= 10;
    flags.push("schedule_mismatch");
  }

  return {
    ...job,
    score: Math.max(0, Math.min(100, score)),
    excluded: false,
    reasons,
    flags,
  };
}

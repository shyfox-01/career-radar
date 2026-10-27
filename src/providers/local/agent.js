import { EMPLOYMENT_TERMS } from "../../domain/regions.js";
import { classifyJobType } from "../../sources/adapters/job-type.js";

const MAX_SEARCHES = 4;
const MAX_RESUME_CHARS = 12_000;
// Older tool results are shortened before each request so a long session stays inside
// the context window; the ledger keeps every listing, so refs stay valid.
const KEEP_RECENT_TOOL_RESULTS = 4;
const SHORT_TOOL_RESULT = 300;

export const LOCAL_TOOLS = Object.freeze([
  {
    type: "function",
    function: {
      name: "search_jobs",
      description:
        "Run another keyword search on this source. The task's employment-type filter is applied automatically. Listings come back numbered J1, J2, ...",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Keywords such as a job title or a skill" },
          page: { type: "integer", minimum: 0, description: "Result page, 0 for the first" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "job_details",
      description: "Read the full description and requirements of one listing.",
      parameters: {
        type: "object",
        properties: { ref: { type: "string", description: "A listing ref such as J3" } },
        required: ["ref"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_jobs",
      description:
        "Save listings that fit the candidate and the target role. Only refs shown in search results are accepted.",
      parameters: {
        type: "object",
        properties: {
          jobs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                ref: { type: "string" },
                match_reasons: { type: "array", items: { type: "string" } },
                missing_requirements: { type: "array", items: { type: "string" } },
              },
              required: ["ref", "match_reasons", "missing_requirements"],
            },
          },
        },
        required: ["jobs"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "End the search for this task.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
      },
    },
  },
]);

function systemPrompt(sourceName) {
  return [
    `You screen job listings on ${sourceName} for one candidate. A program runs the searches and shows you numbered listings (J1, J2, ...). You cannot browse; act only through the tools.`,
    "Your job is to screen out listings the candidate clearly cannot or would not do, and keep the rest. Missing a suitable job costs more than keeping an extra one: the candidate reviews the saved list.",
    "Leave a listing out only when its work belongs to a different field from the resume (for example sales, marketing or accounting for a data candidate), or when it asks for several more years of experience than the resume shows.",
    "Keep a listing when the resume shows related skills, coursework or projects, even if the tools differ (for example Power BI instead of Tableau). When unsure, keep it.",
    "Refer to listings only by ref. Do not write URLs, titles or company names into tool arguments.",
    "match_reasons: one to three short points in the candidate's favour, each naming a skill, task or field found in both the resume and the listing. Being an internship or entry-level is not a reason on its own. A listing you cannot give such a reason for should not be saved.",
    "missing_requirements: gaps such as years of experience, degrees, certifications or skills the listing asks for and the resume does not show; leave it empty when none are known.",
    "If the first results are thin, try one or two other queries such as synonyms or related titles. Call finish when done.",
  ].join("\n");
}

export function seedQuery(task) {
  const term = EMPLOYMENT_TERMS[task.employmentType]?.[task.market];
  let query = String(task.query ?? "").trim();
  if (term && query.toLocaleLowerCase("en").endsWith(term.toLocaleLowerCase("en")))
    query = query.slice(0, -term.length).trim();
  return query || String(task.roleTitle ?? task.query ?? "").trim();
}

function listingLine(ref, listing) {
  const facts = [
    listing.title,
    listing.company,
    listing.location,
    listing.postedAt ? `posted ${listing.postedAt}` : "",
    listing.employmentTypes.join("/"),
    listing.positionLevels.join("/"),
    listing.minimumYearsExperience !== null ? `${listing.minimumYearsExperience}+ yrs` : "",
    listing.salary,
    listing.skills.length ? `skills: ${listing.skills.slice(0, 8).join(", ")}` : "",
  ].filter(Boolean);
  const excerpt = listing.description.replace(/\s+/gu, " ").slice(0, 160);
  return `${ref} | ${facts.join(" | ")}${excerpt ? `\n    ${excerpt}` : ""}`;
}

function parseArguments(value) {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeRef(value) {
  const text = String(value ?? "")
    .trim()
    .toUpperCase();
  return /^\d+$/u.test(text) ? `J${text}` : text;
}

function textList(value) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items
    .map((item) =>
      String(item ?? "")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 200),
    )
    .filter(Boolean)
    .slice(0, 5);
}

function compact(messages) {
  const toolIndexes = messages.flatMap((message, index) =>
    message.role === "tool" ? [index] : [],
  );
  for (const index of toolIndexes.slice(0, -KEEP_RECENT_TOOL_RESULTS)) {
    const content = messages[index].content;
    if (content.length > SHORT_TOOL_RESULT && !content.endsWith("[shortened]")) {
      messages[index] = {
        ...messages[index],
        content: `${content.slice(0, SHORT_TOOL_RESULT)}\n[shortened]`,
      };
    }
  }
}

// One task, one short tool-calling session. The program performs every search and owns
// every fact about a listing. The model only chooses refs and writes match notes, so a
// saved job's title, company and URL are always the ones the source returned.
export async function runLocalTask({
  client,
  model,
  task,
  redactedResume,
  search,
  shouldStop = () => false,
  maxSteps = 8,
  now = () => new Date().toISOString(),
}) {
  const ledger = new Map();
  const refsByUrl = new Map();
  const refsByContent = new Map();
  const saved = new Map();
  const seen = new Set();
  let searches = 0;

  // Employers often post the same vacancy several times under new links. A listing whose
  // title, company and full description match an earlier one is that earlier listing.
  function contentKey(listing) {
    if (!listing.description) return null;
    return [listing.title, listing.company, listing.description]
      .map((part) => part.toLocaleLowerCase("en").replace(/\s+/gu, " ").trim())
      .join("\u0000");
  }

  async function runSearch(query, page = 0) {
    searches += 1;
    const result = await search.search({ query, page, employmentType: task.employmentType });
    const shown = new Set();
    const lines = [];
    for (const listing of result.listings) {
      const key = contentKey(listing);
      let ref = refsByUrl.get(listing.url) ?? (key ? refsByContent.get(key) : undefined);
      if (!ref) {
        ref = `J${ledger.size + 1}`;
        ledger.set(ref, listing);
        if (key) refsByContent.set(key, ref);
      }
      refsByUrl.set(listing.url, ref);
      if (shown.has(ref)) continue;
      shown.add(ref);
      lines.push(listingLine(ref, ledger.get(ref)));
    }
    const header = `Search "${query}" page ${result.page}: ${result.total ?? "unknown"} total, ${lines.length} shown.`;
    return lines.length ? `${header}\n${lines.join("\n")}` : `${header}\nNo listings.`;
  }

  async function execute(name, args) {
    const key = `${name}:${JSON.stringify(args)}`;
    if (name !== "finish" && seen.has(key))
      return {
        content: "You already made this exact call; its result is above. Choose another action.",
        productive: false,
      };
    seen.add(key);
    if (name === "search_jobs") {
      const query = String(args.query ?? "").trim();
      if (!query) return { content: "search_jobs needs a query.", productive: false };
      if (searches >= MAX_SEARCHES)
        return {
          content: "Search limit reached for this task. Save the fitting listings and call finish.",
          productive: false,
        };
      const before = ledger.size;
      const content = await runSearch(query, Number(args.page) || 0);
      return { content, productive: ledger.size > before };
    }
    if (name === "job_details") {
      const ref = normalizeRef(args.ref);
      const listing = ledger.get(ref);
      if (!listing)
        return {
          content: `Unknown ref ${ref}. Use a ref from the search results.`,
          productive: false,
        };
      return {
        content: [
          `${ref} | ${listing.title} | ${listing.company}`,
          listing.skills.length ? `Skills: ${listing.skills.join(", ")}` : "",
          listing.minimumYearsExperience !== null
            ? `Minimum experience: ${listing.minimumYearsExperience} years`
            : "",
          listing.description.slice(0, 2_500),
        ]
          .filter(Boolean)
          .join("\n"),
        productive: true,
      };
    }
    if (name === "save_jobs") {
      const accepted = [];
      const rejected = [];
      const unexplained = [];
      for (const item of Array.isArray(args.jobs) ? args.jobs : []) {
        const ref = normalizeRef(item?.ref);
        if (!ledger.has(ref)) {
          rejected.push(ref || "(blank)");
          continue;
        }
        const matchReasons = textList(item.match_reasons);
        // A listing the model cannot argue for is one it has already judged unsuitable.
        if (!matchReasons.length) {
          unexplained.push(ref);
          continue;
        }
        if (!saved.has(ref)) accepted.push(ref);
        saved.set(ref, { matchReasons, missingRequirements: textList(item.missing_requirements) });
      }
      const parts = [accepted.length ? `Saved ${accepted.join(", ")}.` : "Nothing new saved."];
      if (rejected.length)
        parts.push(`Not accepted, not from any search result: ${rejected.join(", ")}.`);
      if (unexplained.length)
        parts.push(`Not saved, no reason in the candidate's favour: ${unexplained.join(", ")}.`);
      parts.push(`${saved.size} saved in total.`);
      return { content: parts.join(" "), productive: accepted.length > 0 };
    }
    if (name === "finish") return { content: "Finished.", productive: true, finish: true };
    return { content: `Unknown tool ${name}.`, productive: false };
  }

  const firstQuery = seedQuery(task);
  const firstResults = await runSearch(firstQuery);
  const messages = [
    { role: "system", content: systemPrompt(search.name) },
    {
      role: "user",
      content: [
        "<resume>",
        String(redactedResume ?? "").slice(0, MAX_RESUME_CHARS),
        "</resume>",
        `Target role: ${task.roleTitle || firstQuery}. Employment type: ${task.employmentType}. Market: ${task.market}. Source: ${search.name}.`,
        firstResults,
        "Save the listings that fit with save_jobs, then call finish.",
      ].join("\n"),
    },
  ];

  let stopReason = "step_limit";
  let nudged = false;
  let unproductive = 0;
  for (let step = 0; step < maxSteps; step += 1) {
    if (shouldStop()) {
      stopReason = "cancelled";
      break;
    }
    if (step === maxSteps - 2)
      messages.push({
        role: "user",
        content: "Almost out of steps: save the fitting listings now and call finish.",
      });
    const reply = await client.chat({ model, messages, tools: LOCAL_TOOLS });
    const message = reply?.message ?? {};
    const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    messages.push({
      role: "assistant",
      content: String(message.content ?? ""),
      ...(calls.length ? { tool_calls: calls } : {}),
    });
    if (!calls.length) {
      if (nudged) {
        stopReason = "model_stopped";
        break;
      }
      nudged = true;
      messages.push({
        role: "user",
        content: "Use the tools: call save_jobs for the fitting listings, then finish.",
      });
      continue;
    }
    let finished = false;
    let productive = false;
    for (const call of calls) {
      const name = String(call?.function?.name ?? "");
      const outcome = await execute(name, parseArguments(call?.function?.arguments));
      messages.push({ role: "tool", tool_name: name, content: outcome.content });
      productive ||= outcome.productive;
      finished ||= Boolean(outcome.finish);
    }
    if (finished) {
      stopReason = "finished";
      break;
    }
    unproductive = productive ? 0 : unproductive + 1;
    if (unproductive >= 3) {
      stopReason = "unproductive";
      break;
    }
    compact(messages);
  }

  const seenAt = now();
  const jobs = [...saved].map(([ref, notes]) => {
    const listing = ledger.get(ref);
    return {
      title: listing.title,
      company: listing.company,
      rawCompany: listing.company,
      url: listing.url,
      location: listing.location,
      postedAt: listing.postedAt,
      postedText: listing.postedAt ?? "",
      expiresAt: listing.expiresAt,
      source: search.name,
      sourceId: task.sourceId,
      sourceTaskId: task.id,
      market: task.market,
      employmentType: classifyJobType(listing.title, listing.employmentText),
      targetEmploymentType: task.employmentType,
      // Every field above was read from the source; only the notes below are the model's.
      verification: "source_checked",
      matchReasons: notes.matchReasons,
      missingRequirements: notes.missingRequirements,
      selectedBy: `ollama:${model}`,
      salary: listing.salary,
      skills: listing.skills,
      description: listing.description.slice(0, 1_500),
      classification: listing.categories.join(", "),
      subClassification: listing.positionLevels.join(", "),
      firstSeenAt: seenAt,
      lastSeenAt: seenAt,
      sourceFieldWarnings: [],
    };
  });
  return { jobs, stopReason, listingsSeen: ledger.size, searches };
}

const ROLE_CATALOG = Object.freeze([
  {
    id: "ai_engineer",
    zh: "AI工程师",
    family: "ai_engineering",
    title: "AI Engineer",
    aliases: ["ai engineer", "artificial intelligence engineer", "ai engineering"],
    keywords: [
      "llm",
      "rag",
      "prompt",
      "agent",
      "machine learning",
      "python",
      "人工智能",
      "大语言模型",
    ],
  },
  {
    id: "machine_learning_engineer",
    zh: "机器学习工程师",
    family: "ai_engineering",
    title: "Machine Learning Engineer",
    aliases: ["machine learning engineer", "ml engineer", "机器学习工程师"],
    keywords: [
      "machine learning",
      "deep learning",
      "model training",
      "pytorch",
      "tensorflow",
      "python",
      "机器学习",
    ],
  },
  {
    id: "applied_scientist",
    zh: "应用科学家",
    family: "research",
    title: "Applied Scientist",
    aliases: ["applied scientist", "research scientist", "应用科学家"],
    keywords: [
      "research",
      "experiment",
      "model evaluation",
      "deep learning",
      "nlp",
      "computer vision",
      "科研",
    ],
  },
  {
    id: "data_scientist",
    zh: "数据科学家",
    family: "data",
    title: "Data Scientist",
    aliases: ["data scientist", "数据科学家"],
    keywords: [
      "statistics",
      "machine learning",
      "feature engineering",
      "prediction",
      "python",
      "sql",
      "数据科学",
    ],
  },
  {
    id: "data_engineer",
    zh: "数据工程师",
    family: "data",
    title: "Data Engineer",
    aliases: ["data engineer", "数据工程师"],
    keywords: [
      "etl",
      "pipeline",
      "data preprocessing",
      "spark",
      "warehouse",
      "python",
      "sql",
      "数据处理",
    ],
  },
  {
    id: "analytics_engineer",
    zh: "数据分析工程师",
    family: "data",
    title: "Analytics Engineer",
    aliases: ["analytics engineer", "分析工程师"],
    keywords: ["analytics", "data modeling", "dbt", "warehouse", "sql", "business intelligence"],
  },
  {
    id: "data_analyst",
    zh: "数据分析师",
    family: "data",
    title: "Data Analyst",
    aliases: ["data analyst", "business data analyst", "数据分析师"],
    keywords: ["analytics", "data analysis", "dashboard", "excel", "python", "sql", "数据分析"],
  },
  {
    id: "software_engineer",
    zh: "软件工程师",
    family: "software",
    title: "Software Engineer",
    aliases: ["software engineer", "软件工程师"],
    keywords: ["software", "application", "api", "testing", "python", "java", "软件"],
  },
  {
    id: "backend_engineer",
    zh: "后端工程师",
    family: "software",
    title: "Backend Engineer",
    aliases: ["backend engineer", "backend developer", "后端工程师"],
    keywords: ["backend", "api", "database", "distributed", "python", "java", "后端"],
  },
  {
    id: "product_manager",
    zh: "产品经理",
    family: "product",
    title: "Product Manager",
    aliases: ["product manager", "product management", "产品经理"],
    keywords: [
      "product",
      "roadmap",
      "requirements",
      "user research",
      "adoption",
      "metrics",
      "产品",
    ],
  },
  {
    id: "technical_product_manager",
    zh: "技术产品经理",
    family: "product",
    title: "Technical Product Manager",
    aliases: ["technical product manager", "ai product manager", "技术产品经理", "ai产品经理"],
    keywords: ["product", "technical", "ai", "api", "requirements", "roadmap", "产品"],
  },
  {
    id: "fintech_analyst",
    zh: "金融科技",
    family: "fintech",
    title: "FinTech Analyst",
    aliases: ["fintech analyst", "financial technology analyst", "金融科技"],
    keywords: ["fintech", "finance", "digital banking", "payments", "analytics", "金融科技"],
  },
  {
    id: "quantitative_analyst",
    zh: "量化分析师",
    family: "fintech",
    title: "Quantitative Analyst",
    aliases: ["quantitative analyst", "quant analyst", "量化分析师"],
    keywords: [
      "quant",
      "portfolio",
      "trading",
      "time series",
      "optimization",
      "statistics",
      "python",
      "量化",
    ],
  },
  {
    id: "investment_analyst",
    zh: "投资分析师",
    family: "finance",
    title: "Investment Analyst",
    aliases: ["investment analyst", "research analyst", "投资分析师"],
    keywords: ["investment", "portfolio", "valuation", "financial modeling", "markets", "投资"],
  },
  {
    id: "risk_analyst",
    zh: "风险分析师",
    family: "risk",
    title: "Risk Analyst",
    aliases: ["risk analyst", "risk management", "风险分析师"],
    keywords: ["risk", "compliance", "credit", "fraud", "controls", "analytics", "风险"],
  },
  {
    id: "business_analyst",
    zh: "业务分析师",
    family: "business",
    title: "Business Analyst",
    aliases: ["business analyst", "业务分析师", "商业分析师"],
    keywords: [
      "business analysis",
      "stakeholder",
      "requirements",
      "process",
      "analytics",
      "业务分析",
    ],
  },
  {
    id: "strategy_analyst",
    zh: "战略分析师",
    family: "business",
    title: "Strategy Analyst",
    aliases: ["strategy analyst", "strategy associate", "战略分析师"],
    keywords: [
      "strategy",
      "market research",
      "competitive analysis",
      "business",
      "financial modeling",
      "战略",
    ],
  },
  {
    id: "operations_analyst",
    zh: "运营分析师",
    family: "operations",
    title: "Operations Analyst",
    aliases: ["operations analyst", "运营分析师"],
    keywords: ["operations", "process improvement", "reporting", "sql", "analytics", "运营"],
  },
  {
    id: "supply_chain_analyst",
    zh: "供应链分析师",
    family: "operations",
    title: "Supply Chain Analyst",
    aliases: ["supply chain analyst", "logistics analyst", "供应链分析师", "物流分析师"],
    keywords: [
      "supply chain",
      "logistics",
      "forecasting",
      "optimization",
      "operations",
      "供应链",
      "物流",
    ],
  },
  {
    id: "research_assistant",
    zh: "研究助理",
    family: "research",
    title: "Research Assistant",
    aliases: ["research assistant", "research associate", "研究助理"],
    keywords: ["research", "literature", "experiment", "data collection", "analysis", "研究"],
  },
]);

function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/\s+/gu, " ")
    .trim();
}

function uniqueNormalized(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const clean = normalize(value);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
}

function matchingTerms(haystack, terms, limit = 5) {
  return [
    ...new Set(terms.filter((term) => haystack.includes(normalize(term))).map(normalize)),
  ].slice(0, limit);
}

function supportFor(role, postingSupport) {
  const direct = Number(postingSupport?.[role.id]);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const byTitle = Number(postingSupport?.[role.title]);
  return Number.isFinite(byTitle) && byTitle > 0 ? byTitle : 0;
}

export function suggestRoles({ resumeText = "", preferences = {}, postingSupport = {} } = {}) {
  const resume = normalize(resumeText).slice(0, 60_000);
  const interests = uniqueNormalized(preferences.roleInterests).slice(0, 30);
  const skills = uniqueNormalized(preferences.emphasizedSkills).slice(0, 30);
  const industries = uniqueNormalized(preferences.industries).slice(0, 20);
  const exclusions = uniqueNormalized(preferences.excludedWork).slice(0, 20);
  const preferenceText = [...interests, ...skills, ...industries].join(" | ");
  const exclusionText = exclusions.join(" | ");

  return ROLE_CATALOG.map((role) => {
    const titleTerms = [role.title, ...role.aliases].map(normalize);
    const resumeHits = matchingTerms(resume, [...titleTerms, ...role.keywords]);
    const skillHits = matchingTerms(skills.join(" | "), role.keywords);
    const industryHits = matchingTerms(industries.join(" | "), role.keywords);
    const exactInterest = interests.find((item) => titleTerms.includes(item));
    const adjacentInterest = interests.find(
      (item) =>
        titleTerms.some((term) => term.includes(item) || item.includes(term)) ||
        role.keywords.some(
          (term) => normalize(term).includes(item) || item.includes(normalize(term)),
        ),
    );
    const postingCount = supportFor(role, postingSupport);
    const excludedHits = matchingTerms(exclusionText, [...titleTerms, ...role.keywords], 3);

    const resumeScore = Math.min(45, resumeHits.length * 9);
    const preferenceScore = Math.min(
      25,
      (exactInterest ? 18 : adjacentInterest ? 12 : 0) +
        skillHits.length * 4 +
        industryHits.length * 2,
    );
    const postingScore = Math.min(20, Math.round(Math.log2(postingCount + 1) * 4));
    const marketPrior = preferenceText ? 6 : 10;
    const exclusionPenalty = Math.min(35, excludedHits.length * 15);
    const evidence = [];
    if (exactInterest || adjacentInterest)
      evidence.push(`Stated preference: ${exactInterest ?? adjacentInterest}`);
    if (resumeHits.length) evidence.push(`Resume evidence: ${resumeHits.join(", ")}`);
    if (skillHits.length) evidence.push(`Skill emphasis: ${skillHits.join(", ")}`);
    if (industryHits.length) evidence.push(`Industry alignment: ${industryHits.join(", ")}`);
    if (postingCount) evidence.push(`Posting sample support: ${postingCount}`);
    if (excludedHits.length)
      evidence.push(`Possible exclusion overlap: ${excludedHits.join(", ")}`);
    if (!evidence.length) evidence.push("Canonical role catalog fallback");

    return {
      id: role.id,
      family: role.family,
      title: role.title,
      score: Math.max(
        0,
        Math.min(
          100,
          resumeScore + preferenceScore + postingScore + marketPrior - exclusionPenalty,
        ),
      ),
      evidence,
      selected: false,
    };
  })
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "en"))
    .slice(0, 12);
}

export function normalizeApprovedRoles(input) {
  if (!Array.isArray(input)) throw new TypeError("Approved roles must be an array");
  const output = [];
  const seen = new Set();
  for (const value of input) {
    const title = String(value ?? "")
      .normalize("NFKC")
      .replace(/\s+/gu, " ")
      .trim();
    if (!title) continue;
    if (title.length > 80 || /[<>\u0000-\u001F\u007F]/u.test(title)) {
      throw new TypeError("Unsupported role title");
    }
    const key = title.toLocaleLowerCase("en");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(title);
  }
  if (output.length > 20) throw new RangeError("Approved roles may contain at most 20 titles");
  return output;
}

// Mainland job boards index Chinese titles; an approved English title alone finds almost nothing there.
const CN_ROLE_TERMS = new Map(
  ROLE_CATALOG.flatMap((role) =>
    [role.title, ...role.aliases].map((name) => [normalize(name), role.zh]),
  ),
);

export function localizeRoleTerm(term, market) {
  if (market !== "CN") return term;
  const text = String(term ?? "").trim();
  // A title the user typed in Chinese, or one outside the catalog, is used exactly as written.
  if (!text || /\p{Script=Han}/u.test(text)) return text;
  return CN_ROLE_TERMS.get(normalize(text)) ?? text;
}

export { ROLE_CATALOG };

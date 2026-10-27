export const MARKETS = Object.freeze({
  SG: {
    label: "Singapore",
    defaultCities: ["Singapore"],
    providers: [
      {
        name: "MyCareersFuture",
        access: "direct",
        url: (query) =>
          `https://www.mycareersfuture.gov.sg/search?search=${encodeURIComponent(query)}`,
      },
      {
        name: "LinkedIn",
        access: "direct",
        url: (query) =>
          `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=Singapore`,
      },
      {
        name: "JobStreet Singapore",
        access: "direct",
        url: (query) =>
          `https://sg.jobstreet.com/${encodeURIComponent(query).replaceAll("%20", "-")}-jobs`,
      },
    ],
  },
  CN: {
    label: "Mainland China",
    defaultCities: ["Shanghai", "Shenzhen", "Beijing", "Guangzhou"],
    providers: [
      {
        name: "BOSS Zhipin",
        access: "direct",
        url: (query) => `https://www.zhipin.com/web/geek/jobs?query=${encodeURIComponent(query)}`,
      },
      {
        name: "Liepin",
        access: "direct",
        url: (query) => `https://www.liepin.com/zhaopin/?key=${encodeURIComponent(query)}`,
      },
      {
        name: "Zhaopin",
        access: "direct",
        url: (query) => `https://sou.zhaopin.com/?kw=${encodeURIComponent(query)}`,
      },
    ],
  },
  HK: {
    label: "Hong Kong",
    defaultCities: ["Hong Kong"],
    providers: [
      {
        name: "JobsDB Hong Kong",
        access: "direct",
        url: (query) =>
          `https://hk.jobsdb.com/${encodeURIComponent(query).replaceAll("%20", "-")}-jobs`,
      },
      {
        name: "CTgoodjobs",
        access: "direct",
        url: (query) => `https://www.ctgoodjobs.hk/SearchJobs/${encodeURIComponent(query)}`,
      },
      {
        name: "LinkedIn",
        access: "direct",
        url: (query) =>
          `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(query)}&location=Hong%20Kong`,
      },
    ],
  },
});

export const ROLE_FAMILIES = Object.freeze({
  ai_engineering: {
    label: "AI / ML Engineering",
    terms: {
      SG: ["AI engineer", "machine learning engineer"],
      CN: ["AI工程师", "机器学习工程师"],
      HK: ["AI engineer", "machine learning engineer"],
    },
  },
  data: {
    label: "Data",
    terms: {
      SG: ["data analyst", "data engineer"],
      CN: ["数据分析师", "数据工程师"],
      HK: ["data analyst", "data engineer"],
    },
  },
  product: {
    label: "Product",
    terms: {
      SG: ["AI product manager", "technical product manager"],
      CN: ["AI产品经理", "技术产品经理"],
      HK: ["AI product manager", "technical product manager"],
    },
  },
  fintech: {
    label: "FinTech / Quant",
    terms: {
      SG: ["fintech analyst", "quantitative analyst"],
      CN: ["金融科技", "量化分析师"],
      HK: ["fintech analyst", "quantitative analyst"],
    },
  },
});

export const EMPLOYMENT_TERMS = Object.freeze({
  internship: { SG: "internship", CN: "实习", HK: "internship" },
  full_time: { SG: "full time", CN: "全职", HK: "full time" },
});

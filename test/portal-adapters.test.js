import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  MAX_SCROLL_ROUNDS,
  createPortalAdapter,
  normalizeSeekCompany,
  portalSnapshotScript,
  splitTitleLocation,
} from "../src/sources/adapters/portal.js";
import { PORTAL_PROFILES } from "../src/sources/adapters/portal-profiles.js";
import { getSourceById } from "../src/sources/catalog.js";
test("every configured snapshot is valid JavaScript", () => {
  for (const p of Object.values(PORTAL_PROFILES))
    assert.doesNotThrow(() => new Function(`return ${portalSnapshotScript(p)}`));
});

test("SEEK company cleanup preserves raw evidence and removes proven display pollution", () => {
  assert.deepEqual(normalizeSeekCompany("NTUC Healthhyperscal.com"), {
    company: "NTUC Health",
    rawCompany: "NTUC Healthhyperscal.com",
    warning: "source_company_normalized",
  });
  assert.deepEqual(normalizeSeekCompany("Strides Digitalstridesdigital.com.sg"), {
    company: "Strides Digital",
    rawCompany: "Strides Digitalstridesdigital.com.sg",
    warning: "source_company_normalized",
  });
  assert.deepEqual(normalizeSeekCompany("Dun & Bradstreet Singapore Pte Ltddnb.com.sg"), {
    company: "Dun & Bradstreet Singapore Pte Ltd",
    rawCompany: "Dun & Bradstreet Singapore Pte Ltddnb.com.sg",
    warning: "source_company_normalized",
  });
  assert.deepEqual(
    normalizeSeekCompany("Pierre Fabre Singapore Pte Ltd pierre-fabrepierre-fabre.com"),
    {
      company: "Pierre Fabre Singapore Pte Ltd",
      rawCompany: "Pierre Fabre Singapore Pte Ltd pierre-fabrepierre-fabre.com",
      warning: "source_company_normalized",
    },
  );
  assert.deepEqual(normalizeSeekCompany("Internship"), {
    company: "",
    rawCompany: "Internship",
    warning: "source_company_unresolved",
  });
  const cssName = "Singapore, SG #job-location.job-location-inline { display: inline; }";
  assert.deepEqual(normalizeSeekCompany(cssName), {
    company: "",
    rawCompany: cssName,
    warning: "source_company_unresolved",
  });
  assert.deepEqual(normalizeSeekCompany("Phillip Securities Pte Ltd"), {
    company: "Phillip Securities Pte Ltd",
    rawCompany: "Phillip Securities Pte Ltd",
    warning: null,
  });
});

test("JobStreet snapshot captures the visible summary and classifications", () => {
  const element = (text, href = "") => ({
    textContent: text,
    innerText: text,
    href,
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const values = {
    'a[data-automation="jobTitle"], a[href*="/job/"]': element(
      "Data Analytics Intern",
      "https://sg.jobstreet.com/job/123",
    ),
    '[data-automation="jobTitle"], h3': element("Data Analytics Intern"),
    '[data-automation="jobCompany"], [data-automation="jobAdvertiser"]': element("Example Pte Ltd"),
    '[data-automation="jobLocation"]': element("Singapore"),
    '[data-automation="jobShortDescription"]': element(
      "Build SQL pipelines and analytics dashboards.",
    ),
    '[data-automation="jobClassification"]': element("(Information & Communication Technology)"),
    '[data-automation="jobSubClassification"]': element("Business/Systems Analysts"),
  };
  const card = {
    matches: () => false,
    closest: () => null,
    querySelector: (s) => values[s] ?? null,
    querySelectorAll: () => [],
  };
  const document = {
    querySelector: () => null,
    querySelectorAll: (s) => (s === PORTAL_PROFILES["sg-jobstreet"].card ? [card] : []),
  };
  const context = {
    document,
    location: {
      href: "https://sg.jobstreet.com/data-analyst-jobs",
      pathname: "/data-analyst-jobs",
    },
    innerWidth: 1200,
    innerHeight: 800,
    URL,
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      pointerEvents: "auto",
    }),
  };
  const snapshot = vm.runInNewContext(
    portalSnapshotScript(PORTAL_PROFILES["sg-jobstreet"]),
    context,
  );
  assert.equal(snapshot.cards[0].description, "Build SQL pipelines and analytics dashboards.");
  assert.equal(snapshot.cards[0].classification, "(Information & Communication Technology)");
  assert.equal(snapshot.cards[0].subClassification, "Business/Systems Analysts");
});

test("Liepin snapshot reads its current camelCase job cards", () => {
  const p = PORTAL_PROFILES["cn-liepin"];
  const element = (text, href = "") => ({
    textContent: text,
    innerText: text,
    href,
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const values = {
    [p.link]: element("信贷数据分析岗", "https://www.liepin.com/job/1983911885.shtml"),
    [p.title]: element("信贷数据分析岗"),
    [p.company]: element("示例银行股份有限公司"),
    [p.location]: element("深圳"),
  };
  const card = {
    matches: () => false,
    closest: () => null,
    querySelector: (s) => values[s] ?? null,
    querySelectorAll: () => [],
  };
  const document = {
    querySelector: () => null,
    querySelectorAll: (s) => (s === p.card ? [card] : []),
  };
  const context = {
    document,
    location: { href: "https://www.liepin.com/zhaopin/?key=x", pathname: "/zhaopin/" },
    innerWidth: 1200,
    innerHeight: 800,
    URL,
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      pointerEvents: "auto",
    }),
  };
  const snapshot = vm.runInNewContext(portalSnapshotScript(p), context);
  assert.match(p.card, /\.jobCardPcContainer/);
  assert.deepEqual(
    [snapshot.cards[0].title, snapshot.cards[0].company, snapshot.cards[0].location],
    ["信贷数据分析岗", "示例银行股份有限公司", "深圳"],
  );
});

test("Indeed page-two sign-in redirect is reported as a login gate the window can reach", () => {
  const document = { querySelector: () => null, querySelectorAll: () => [] };
  const context = {
    document,
    location: {
      href: "https://secure.indeed.com/auth?co=SG&branding=page-two-signin",
      pathname: "/auth",
    },
    innerWidth: 1200,
    innerHeight: 800,
    URL,
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      pointerEvents: "auto",
    }),
  };
  const snapshot = vm.runInNewContext(portalSnapshotScript(PORTAL_PROFILES["sg-indeed"]), context);
  assert.equal(snapshot.login, true);
  assert.ok(createPortalAdapter("sg-indeed").navigationHosts.includes("secure.indeed.com"));
  assert.ok(createPortalAdapter("hk-indeed").navigationHosts.includes("secure.indeed.com"));
  assert.ok(!createPortalAdapter("sg-jobstreet").navigationHosts.includes("secure.indeed.com"));
});

test("an offscreen transparent captcha remnant is not an active challenge", () => {
  const body = {
    tagName: "BODY",
    parentElement: null,
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1200,
      bottom: 800,
      width: 1200,
      height: 800,
    }),
  };
  const wrapper = {
    tagName: "DIV",
    id: "tcaptcha_transform_dy",
    className: "",
    parentElement: body,
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({
      x: 0,
      y: -1000000,
      left: 0,
      top: -1000000,
      right: 300,
      bottom: -999850,
      width: 300,
      height: 150,
    }),
  };
  const iframe = {
    tagName: "IFRAME",
    id: "tcaptcha_iframe_dy",
    className: "",
    parentElement: wrapper,
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({
      x: 0,
      y: -1000000,
      left: 0,
      top: -1000000,
      right: 300,
      bottom: -999850,
      width: 300,
      height: 150,
    }),
  };
  const document = {
    querySelector: () => null,
    querySelectorAll: (selector) => (selector.includes('iframe[src*="captcha"]') ? [iframe] : []),
  };
  const context = {
    document,
    location: { href: "https://www.shixiseng.com/interns", pathname: "/interns" },
    innerWidth: 1200,
    innerHeight: 800,
    URL,
    getComputedStyle: (element) => ({
      display: "block",
      visibility: "visible",
      opacity: element === wrapper ? "0" : "1",
      pointerEvents: "auto",
    }),
  };
  const snapshot = vm.runInNewContext(
    portalSnapshotScript(PORTAL_PROFILES["cn-shixiseng"]),
    context,
  );
  assert.equal(snapshot.challenge, false);
});

test("Shixiseng snapshot reads the company from its current public job card", () => {
  const element = (text, href = "") => ({
    textContent: text,
    innerText: text,
    href,
    matches: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const title = element("数据分析", "https://www.shixiseng.com/intern/inn_public");
  const company = element("示例公司", "javascript:;");
  const city = element("北京");
  const next = {
    disabled: false,
    getAttribute: (name) => (name === "aria-disabled" ? null : name === "href" ? null : null),
    closest: () => null,
  };
  const card = {
    matches: () => false,
    closest: () => null,
    querySelector: (selector) =>
      selector === 'a[href*="/intern/"]' || selector === ".title, .intern-name"
        ? title
        : selector === "a.title.ellipsis:not(.font)"
          ? company
          : selector === ".city, .city-name"
            ? city
            : null,
    querySelectorAll: () => [],
  };
  const document = {
    querySelector: (selector) => (selector.includes(".btn-next") ? next : null),
    querySelectorAll: (selector) => (selector === ".intern-wrap, .intern-detail" ? [card] : []),
  };
  const context = {
    document,
    location: { href: "https://www.shixiseng.com/interns", pathname: "/interns" },
    innerWidth: 1200,
    innerHeight: 800,
    URL,
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      pointerEvents: "auto",
    }),
  };
  const snapshot = vm.runInNewContext(
    portalSnapshotScript(PORTAL_PROFILES["cn-shixiseng"]),
    context,
  );
  assert.equal(snapshot.cards.length, 1);
  assert.equal(snapshot.cards[0].company, "示例公司");
  assert.equal(snapshot.nextButton, true);
});

test("Zhaopin snapshot reads the public title and URL from its current Vue job card", () => {
  const company = { textContent: "示例药业" };
  const location = { textContent: "北京 海淀" };
  const card = {
    __vueParentComponent: {
      props: {
        job: {
          name: "数据分析师",
          companyName: "示例药业",
          workCity: "北京",
          positionURL: "http://www.zhaopin.com/jobdetail/CC123J1.htm",
        },
      },
    },
    matches: () => false,
    closest: () => null,
    querySelector: (selector) =>
      selector.includes("job-card__title")
        ? { textContent: "" }
        : selector.includes("job-card__company-name")
          ? company
          : selector.includes("job-card__location")
            ? location
            : null,
    querySelectorAll: () => [],
  };
  const document = {
    querySelector: () => null,
    querySelectorAll: (selector) => (selector === ".job-card" ? [card] : []),
  };
  const context = {
    document,
    location: { href: "https://www.zhaopin.com/jobs", pathname: "/jobs" },
    innerWidth: 1200,
    innerHeight: 800,
    URL,
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      pointerEvents: "auto",
    }),
  };
  const snapshot = vm.runInNewContext(portalSnapshotScript(PORTAL_PROFILES["cn-zhaopin"]), context);
  assert.equal(snapshot.cards.length, 1);
  assert.equal(snapshot.cards[0].title, "数据分析师");
  assert.equal(snapshot.cards[0].url, "https://www.zhaopin.com/jobdetail/CC123J1.htm");
});

test("Lagou snapshot maps its current React result data onto the visible job card", () => {
  const card = {
    matches: () => false,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  card.__reactInternalInstance$test = {
    memoizedProps: {
      content: {
        positionResult: {
          result: [
            {
              positionId: 11142767,
              positionName: "高级数据分析师",
              companyShortName: "示例科技",
              city: "上海",
              jobNature: "全职",
            },
          ],
        },
      },
    },
    return: null,
  };
  const document = {
    querySelector: (selector) => (selector.includes('[class*="item__"]') ? card : null),
    querySelectorAll: (selector) => (selector.includes('[class*="item__"]') ? [card] : []),
  };
  const context = {
    document,
    location: { href: "https://www.lagou.com/wn/jobs?kd=data", pathname: "/wn/jobs" },
    innerWidth: 1200,
    innerHeight: 800,
    URL,
    getComputedStyle: () => ({
      display: "block",
      visibility: "visible",
      opacity: "1",
      pointerEvents: "auto",
    }),
  };
  const snapshot = vm.runInNewContext(portalSnapshotScript(PORTAL_PROFILES["cn-lagou"]), context);
  assert.equal(snapshot.cards.length, 1);
  assert.equal(snapshot.cards[0].title, "高级数据分析师");
  assert.equal(snapshot.cards[0].company, "示例科技");
  assert.equal(snapshot.cards[0].url, "https://www.lagou.com/wn/jobs/11142767.html");
});
test("a source can read publicly visible cards without pretending the user authenticated", async () => {
  const adapter = createPortalAdapter("sg-jobstreet");
  const source = getSourceById("sg-jobstreet");
  const result = await adapter.probe({
    source,
    driver: {
      navigate: async () => {},
      waitForReady: async () => {},
      snapshot: async () => ({
        cards: [{ title: "Analyst", company: "Example", url: "https://sg.jobstreet.com/job/123" }],
        challenge: false,
        login: false,
        endConfirmed: true,
      }),
    },
  });
  assert.equal(result.authentication, "not_required");
  assert.equal(result.extraction, "ready");
});
test("captcha and missing card fields never count as a successful connection", async () => {
  const adapter = createPortalAdapter("cn-zhipin", { pause: async () => {} });
  const source = getSourceById("cn-zhipin");
  const driver = {
    navigate: async () => {},
    waitForReady: async () => {},
    snapshot: async () => ({ cards: [], challenge: true }),
  };
  assert.equal((await adapter.probe({ source, driver })).authentication, "challenge");
  driver.snapshot = async () => ({ cards: [], login: true });
  assert.equal((await adapter.probe({ source, driver })).authentication, "signed_out");
});
test("button pagination waits for changed cards and resumes the saved page", async () => {
  const source = getSourceById("cn-zhipin"),
    adapter = createPortalAdapter("cn-zhipin", { pause: async () => {} });
  let page = 1,
    clicks = 0;
  const snapshot = () => ({
    cards: [
      {
        title: `Analyst ${page}`,
        company: "Example",
        url: `https://www.zhipin.com/job_detail/${page}.html`,
      },
    ],
    nextButton: page < 3,
    endConfirmed: page === 3,
  });
  const driver = {
    navigate: async () => {
      page = 1;
    },
    waitForReady: async () => {},
    snapshot: async () => snapshot(),
    act: async (script) => {
      if (script.includes("b.click()")) {
        page++;
        clicks++;
        return true;
      }
      return { atEnd: true };
    },
  };
  const task = {
    id: "one",
    sourceId: source.id,
    searchUrl: source.searchUrl("数据分析"),
    market: "CN",
    employmentType: "full_time",
  };
  const first = await adapter.discover({ source, task, driver, maxPages: 1 });
  assert.equal(first.scan.complete, false);
  assert.match(first.scan.nextUrl, /#career-radar-page=2$/);
  const second = await adapter.discover({
    source,
    task: { ...task, resumeUrl: first.scan.nextUrl },
    driver,
    maxPages: 5,
  });
  assert.equal(second.scan.complete, true);
  assert.deepEqual(
    second.jobs.map((j) => j.title),
    ["Analyst 2", "Analyst 3"],
  );
  assert.equal(clicks, 2);
});
test("iES submits the requested keyword and retains an employer-unnamed public listing", async () => {
  const source = getSourceById("hk-ies"),
    adapter = createPortalAdapter("hk-ies", { pause: async () => {} });
  let submitted = false;
  const navigations = [];
  const driver = {
    navigate: async (url) => {
      navigations.push(url);
    },
    waitForReady: async () => {},
    act: async (script) => {
      if (script.includes("requestSubmit")) {
        assert.ok(script.includes("Data Analyst"));
        submitted = true;
        return true;
      }
      if (script.includes("joblist"))
        return "https://www2.jobs.gov.hk/0/en/jobseeker/jobsearch/joblist/?direct=False";
      return { atEnd: true };
    },
    snapshot: async () => ({
      url: "https://www2.jobs.gov.hk/0/en/jobseeker/jobsearch/joblist/",
      cards: submitted
        ? [
            {
              title: "Data Analyst",
              company: "",
              url: "https://www2.jobs.gov.hk/0/en/jobseeker/jobCard/?order=public-id",
            },
          ]
        : [],
      endConfirmed: true,
    }),
  };
  const result = await adapter.discover({
    source,
    driver,
    task: {
      id: "ies",
      sourceId: "hk-ies",
      query: "Data Analyst",
      searchUrl: source.searchUrl("Data Analyst"),
      market: "HK",
    },
  });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.jobs[0].company, "");
  assert.equal(result.scan.complete, true);
  assert.equal(
    navigations.at(-1),
    "https://www2.jobs.gov.hk/0/en/jobseeker/jobsearch/joblist/?direct=False",
  );
});
test("infinite-scroll continuation reuses the same loaded query instead of restarting at its first cards", async () => {
  const source = getSourceById("cn-zhipin"),
    adapter = createPortalAdapter("cn-zhipin", { pause: async () => {} }),
    url = source.searchUrl("数据分析");
  const feedLength = MAX_SCROLL_ROUNDS + 10;
  let scroll = 0,
    navigations = 0;
  const driver = {
    navigate: async () => {
      scroll = 0;
      navigations++;
    },
    waitForReady: async () => {},
    snapshot: async () => ({
      url,
      cards: [
        {
          title: `Analyst ${scroll}`,
          company: "Synthetic",
          url: `https://www.zhipin.com/job_detail/${scroll}.html`,
        },
      ],
      endConfirmed: scroll >= feedLength,
    }),
    act: async () => {
      if (scroll < feedLength) scroll++;
      return { atEnd: scroll >= feedLength };
    },
  };
  const task = { id: "scroll", sourceId: source.id, searchUrl: url, market: "CN" };
  const first = await adapter.discover({ driver, source, task });
  assert.equal(first.scan.stopReason, "scroll_limit");
  assert.equal(first.scan.complete, false);
  const second = await adapter.discover({
    driver,
    source,
    task: { ...task, resumeUrl: first.scan.nextUrl },
  });
  assert.equal(navigations, 1);
  assert.equal(second.scan.complete, true);
  assert.ok(second.jobs.some((j) => j.title === `Analyst ${feedLength}`));
});
test("a feed that appends its next batch a few rounds after reaching the end is still read", async () => {
  const source = getSourceById("cn-zhaopin"),
    adapter = createPortalAdapter("cn-zhaopin", { pause: async () => {} }),
    url = source.searchUrl("数据分析");
  let rounds = 0;
  // The second batch appears five rounds after the first scroll reached the end.
  const cards = () =>
    Array.from({ length: rounds >= 5 ? 40 : 20 }, (_, n) => ({
      title: `Analyst ${n}`,
      company: "Synthetic",
      url: `https://www.zhaopin.com/jobdetail/${n}.htm`,
    }));
  const driver = {
    navigate: async () => {},
    waitForReady: async () => {},
    snapshot: async () => ({ url, cards: cards() }),
    act: async () => {
      rounds++;
      return { atEnd: true };
    },
  };
  const result = await adapter.discover({
    driver,
    source,
    task: { id: "late-batch", sourceId: source.id, searchUrl: url, market: "CN" },
    maxPages: 1,
  });
  assert.equal(result.jobs.length, 40);
});
test("public tracking parameters do not turn one job into duplicates on refresh", async () => {
  for (const sourceId of ["cn-nowcoder", "cn-liepin"]) {
    const source = getSourceById(sourceId),
      adapter = createPortalAdapter(sourceId, { pause: async () => {} });
    const base =
      sourceId === "cn-nowcoder"
        ? "https://www.nowcoder.com/jobs/detail/123"
        : "https://www.liepin.com/job/123.shtml";
    const driver = {
      navigate: async () => {},
      waitForReady: async () => {},
      snapshot: async () => ({
        url: source.searchUrl("Data"),
        cards: [1, 2].map((n) => ({
          title: "Data Analyst",
          company: "Synthetic",
          url: `${base}?logid=run${n}&pgRef=page${n}`,
        })),
        endConfirmed: true,
      }),
    };
    const result = await adapter.discover({
      driver,
      source,
      task: { id: sourceId, sourceId, searchUrl: source.searchUrl("Data") },
    });
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].url, base);
  }
});
test("iES last-page link takes precedence over a decorative next-page link", async () => {
  const source = getSourceById("hk-ies"),
    adapter = createPortalAdapter("hk-ies", { pause: async () => {} });
  const list = "https://www1.jobs.gov.hk/0/en/jobseeker/jobsearch/joblist/";
  const driver = {
    navigate: async () => {},
    waitForReady: async () => {},
    act: async (script) =>
      script.includes("requestSubmit") ? true : script.includes("joblist") ? list : { atEnd: true },
    snapshot: async () => ({
      url: list,
      cards: [
        {
          title: "Analyst",
          company: "",
          url: "https://www1.jobs.gov.hk/0/en/jobseeker/jobCard/?order=id",
        },
      ],
      nextButton: true,
      lastPageUrl: list + "?page=1",
      endConfirmed: false,
    }),
  };
  const result = await adapter.discover({
    driver,
    source,
    task: {
      id: "ies",
      sourceId: "hk-ies",
      query: "Data Analyst",
      searchUrl: source.searchUrl("Data Analyst"),
    },
  });
  assert.equal(result.scan.complete, true);
  assert.equal(result.scan.pagesRead, 1);
  assert.equal(result.scan.nextUrl, null);
});
test("a saved URL cannot reuse an unrelated browser page with extra pagination parameters", async () => {
  const source = getSourceById("cn-zhipin"),
    adapter = createPortalAdapter("cn-zhipin", { pause: async () => {} }),
    url = source.searchUrl("Analyst");
  let actual = url + "&page=7",
    navigations = 0;
  const driver = {
    navigate: async (target) => {
      actual = target;
      navigations++;
    },
    waitForReady: async () => {},
    snapshot: async () => ({
      url: actual,
      cards: [
        {
          title: actual.includes("page=7") ? "Skipped ahead" : "First result",
          company: "Synthetic",
          url: "https://www.zhipin.com/job_detail/123.html",
        },
      ],
      endConfirmed: true,
    }),
    act: async () => ({ atEnd: true }),
  };
  const result = await adapter.discover({
    driver,
    source,
    task: { id: "unowned", sourceId: source.id, searchUrl: url, resumeUrl: url },
  });
  assert.equal(navigations, 1);
  assert.equal(result.jobs[0].title, "First result");
});

test("an owned scroll checkpoint is rejected after the browser changes page or the task changes", async () => {
  for (const changed of ["page", "task"]) {
    const source = getSourceById("cn-zhipin"),
      adapter = createPortalAdapter("cn-zhipin", { pause: async () => {} }),
      url = source.searchUrl("Analyst");
    let actual = url,
      scroll = 0,
      navigations = 0;
    const driver = {
      navigate: async (target) => {
        actual = target;
        scroll = 0;
        navigations++;
      },
      waitForReady: async () => {},
      snapshot: async () => ({
        url: actual,
        cards: [
          {
            title: `Analyst ${scroll}`,
            company: "Synthetic",
            url: `https://www.zhipin.com/job_detail/${scroll}.html`,
          },
        ],
      }),
      act: async () => {
        scroll++;
        return { atEnd: false };
      },
    };
    const task = { id: "owner", sourceId: source.id, searchUrl: url };
    const first = await adapter.discover({ driver, source, task });
    if (changed === "page") actual = url + "&page=7";
    await adapter.discover({
      driver,
      source,
      task: { ...task, id: changed === "task" ? "other" : task.id, resumeUrl: first.scan.nextUrl },
    });
    assert.equal(navigations, 2, changed);
  }
});

test("a listing that states its location inside the title is read out, not left blank", () => {
  const cases = [
    ["数据分析师[北京·朝阳门]", "数据分析师", "北京·朝阳门"],
    [
      "高级数据分析师-国际化音乐-上海[上海·闵行区]",
      "高级数据分析师-国际化音乐-上海",
      "上海·闵行区",
    ],
    [
      "用户增长数据分析师（消费信贷） (MJ002572)[北京·望京]",
      "用户增长数据分析师（消费信贷） (MJ002572)",
      "北京·望京",
    ],
  ];
  for (const [raw, title, location] of cases) {
    const parsed = splitTitleLocation(raw);
    assert.equal(parsed.title, title);
    assert.equal(parsed.location, location);
  }
  // A title with no bracketed suffix keeps its own text and reports no location.
  assert.deepEqual(splitTitleLocation("Data Analyst"), { title: "Data Analyst", location: "" });
  assert.deepEqual(splitTitleLocation("Data Analyst (Remote)"), {
    title: "Data Analyst (Remote)",
    location: "",
  });
});

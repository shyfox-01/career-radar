import test from "node:test";
import assert from "node:assert/strict";

import { createSourceAdapterRegistry } from "../src/sources/adapters/registry.js";
import {
  createLinkedInAdapter,
  interpretLinkedInSnapshot,
} from "../src/sources/adapters/linkedin.js";
import { getSourceById } from "../src/sources/catalog.js";

const signedInSnapshot = {
  url: "https://www.linkedin.com/jobs/search/?keywords=Data%20Engineer&location=Singapore",
  title: "Data Engineer Jobs in Singapore | LinkedIn",
  bodyText: "Jobs My Network Messaging Notifications",
  markers: {
    authenticated: 2,
    signedOut: 0,
    challenge: 0,
    searchSurface: 1,
  },
  cards: [
    {
      title: "Data Engineer Intern",
      company: "Example Labs",
      location: "Singapore",
      url: "https://www.linkedin.com/jobs/view/1234567890/?trackingId=secret",
      postedText: "2 days ago",
      description: "Build Python and SQL data pipelines.",
    },
  ],
};

test("registry resolves both LinkedIn markets through one adapter", () => {
  const registry = createSourceAdapterRegistry();
  assert.equal(registry.get("sg-linkedin")?.id, "linkedin");
  assert.equal(registry.get("hk-linkedin")?.id, "linkedin");
  assert.equal(registry.get("sg-jobstreet")?.id, "portal-sg-jobstreet");
});

test("LinkedIn inspection keeps authentication separate from extraction", () => {
  assert.deepEqual(interpretLinkedInSnapshot(signedInSnapshot), {
    authentication: "signed_in",
    extraction: "ready",
    page: "search_results",
    resultCount: 1,
    reason: null,
  });

  assert.deepEqual(
    interpretLinkedInSnapshot({
      ...signedInSnapshot,
      markers: { ...signedInSnapshot.markers, authenticated: 0, signedOut: 3 },
    }),
    {
      authentication: "signed_out",
      extraction: "ready",
      page: "search_results",
      resultCount: 1,
      reason: "sign_in_required",
    },
  );
});

test("LinkedIn inspection reports challenges instead of treating them as empty results", () => {
  assert.deepEqual(
    interpretLinkedInSnapshot({
      url: "https://www.linkedin.com/checkpoint/challenge/abc",
      title: "Security Verification | LinkedIn",
      bodyText: "Let's do a quick security check",
      markers: { authenticated: 0, signedOut: 0, challenge: 2, searchSurface: 0 },
      cards: [],
    }),
    {
      authentication: "challenge",
      extraction: "blocked",
      page: "challenge",
      resultCount: 0,
      reason: "challenge_required",
    },
  );
});

test("LinkedIn adapter navigates, verifies login, and returns normalized jobs", async () => {
  const calls = [];
  const driver = {
    async navigate(url) {
      calls.push(["navigate", url]);
    },
    async waitForReady() {
      calls.push(["waitForReady"]);
    },
    async snapshot(script) {
      assert.match(script, /jobs\/view/iu);
      calls.push(["snapshot"]);
      return structuredClone(signedInSnapshot);
    },
  };
  const adapter = createLinkedInAdapter({ now: () => "2026-09-07T10:00:00.000Z" });
  const task = {
    id: "SG:sg-linkedin:dynamic:internship:Data Engineer",
    sourceId: "sg-linkedin",
    market: "SG",
    employmentType: "internship",
    query: "Data Engineer internship",
    searchUrl: signedInSnapshot.url,
  };

  const result = await adapter.discover({
    driver,
    source: getSourceById("sg-linkedin"),
    task,
    limit: 25,
  });

  assert.deepEqual(calls, [["navigate", signedInSnapshot.url], ["waitForReady"], ["snapshot"]]);
  assert.deepEqual(result.capability, {
    authentication: "signed_in",
    extraction: "ready",
    page: "search_results",
    resultCount: 1,
    reason: null,
  });
  assert.deepEqual(result.jobs, [
    {
      title: "Data Engineer Intern",
      company: "Example Labs",
      location: "Singapore",
      url: "https://www.linkedin.com/jobs/view/1234567890",
      description: "Build Python and SQL data pipelines.",
      skills: [],
      source: "LinkedIn Jobs",
      sourceId: "sg-linkedin",
      sourceTaskId: task.id,
      verification: "source_checked",
      firstSeenAt: "2026-09-07T10:00:00.000Z",
      lastSeenAt: "2026-09-07T10:00:00.000Z",
      postedText: "2 days ago",
      employmentType: "internship",
      market: "SG",
      targetEmploymentType: "internship",
    },
  ]);
});

test("LinkedIn adapter refuses signed-out discovery with an actionable code", async () => {
  const adapter = createLinkedInAdapter();
  const driver = {
    async navigate() {},
    async waitForReady() {},
    async snapshot(script) {
      assert.equal(typeof script, "string");
      return {
        ...signedInSnapshot,
        markers: { ...signedInSnapshot.markers, authenticated: 0, signedOut: 2 },
      };
    },
  };

  await assert.rejects(
    () =>
      adapter.discover({
        driver,
        source: getSourceById("sg-linkedin"),
        task: { sourceId: "sg-linkedin", searchUrl: signedInSnapshot.url },
        limit: 25,
      }),
    (error) => error?.code === "sign_in_required" && /sign in/iu.test(error.message),
  );
});
test("zero-results banners exclude personalized recommendation cards from search hits", async () => {
  const snapshot = { ...signedInSnapshot, markers: { ...signedInSnapshot.markers, noResults: 1 } };
  const result = await createLinkedInAdapter().discover({
    source: getSourceById("sg-linkedin"),
    task: { sourceId: "sg-linkedin", searchUrl: signedInSnapshot.url },
    driver: {
      navigate: async () => {},
      waitForReady: async () => {},
      snapshot: async () => snapshot,
    },
  });
  assert.equal(result.jobs.length, 0);
  assert.equal(result.capability.resultCount, 0);
  assert.equal(result.scan.complete, true);
});

test("verification navigates away from the signed-in feed and waits for job cards", async () => {
  const source = getSourceById("sg-linkedin");
  const calls = [];
  let reads = 0;
  const adapter = createLinkedInAdapter({ pause: async () => calls.push("pause") });
  const result = await adapter.probe({
    source,
    driver: {
      async navigate(url) {
        calls.push(url);
      },
      async waitForReady() {
        calls.push("loaded");
      },
      async snapshot() {
        reads += 1;
        return reads === 1 ? { ...signedInSnapshot, cards: [] } : signedInSnapshot;
      },
    },
  });
  assert.deepEqual(calls, [source.searchUrl(""), "loaded", "pause"]);
  assert.equal(result.authentication, "signed_in");
  assert.equal(result.extraction, "ready");
  assert.equal(result.resultCount, 1);
});

test("a search URL or loading container without readable cards is not proof of extraction", () => {
  const capability = interpretLinkedInSnapshot({ ...signedInSnapshot, cards: [] });
  assert.equal(capability.authentication, "signed_in");
  assert.equal(capability.extraction, "unknown");
  assert.equal(capability.reason, "job_results_not_ready");
  assert.equal(
    interpretLinkedInSnapshot({ ...signedInSnapshot, cards: [{ title: "Example" }] }).extraction,
    "unknown",
  );
  assert.equal(
    interpretLinkedInSnapshot({
      ...signedInSnapshot,
      cards: [],
      markers: { ...signedInSnapshot.markers, noResults: 1 },
    }).extraction,
    "ready",
  );
});

test("verification gives a bounded reading-pending result without discarding successful login", async () => {
  let pauses = 0;
  const adapter = createLinkedInAdapter({
    pause: async () => {
      pauses += 1;
    },
  });
  const result = await adapter.probe({
    source: getSourceById("hk-linkedin"),
    driver: {
      async navigate(url) {
        assert.match(url, /Hong%20Kong/);
      },
      async waitForReady() {},
      async snapshot() {
        return { ...signedInSnapshot, cards: [] };
      },
    },
  });
  assert.equal(pauses, 16);
  assert.equal(result.authentication, "signed_in");
  assert.equal(result.extraction, "unknown");
});

// LinkedIn's signed-in "AI search" page: generated class names, no link on list cards, each
// card naming its job id in a componentkey, and page buttons labelled "第 N 页".
function fakeElement(tagName, attrs = {}, children = []) {
  const node = {
    nodeType: 1,
    tagName,
    childNodes: [],
    parentElement: null,
    getAttribute: (name) => attrs[name] ?? null,
    closest: () => null,
    contains: () => false,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  for (const child of children) {
    const entry = typeof child === "string" ? { nodeType: 3, textContent: child } : child;
    if (entry.nodeType === 1) entry.parentElement = node;
    node.childNodes.push(entry);
  }
  return node;
}
function aiSearchCard(id, title, company, location, { verified = false, posted = "2 天前" } = {}) {
  return fakeElement("DIV", { componentkey: `job-card-component-ref-${id}` }, [
    fakeElement("DIV", {}, [
      fakeElement("SPAN", {}, [verified ? `${title} (已通过验证的职位)` : title]),
      fakeElement("SPAN", {}, [title]),
    ]),
    fakeElement("P", {}, [company]),
    fakeElement("P", {}, [location]),
    fakeElement("SPAN", {}, [`已发布的时间: ${posted}`]),
    fakeElement("P", {}, ["·"]),
    fakeElement("P", {}, ["快速申请"]),
  ]);
}
function aiSearchPage(url, cards, pages, current) {
  const buttons = pages.map((n) =>
    fakeElement("BUTTON", {
      "aria-label": `第 ${n} 页`,
      "aria-current": n === current ? "true" : "false",
    }),
  );
  const selectors = {
    '[componentkey^="job-card-component-ref-"]': cards,
    "button[aria-label]": buttons,
    '[componentkey="primaryNavLinksComponentRef"]': [fakeElement("DIV")],
  };
  const document = {
    title: "Data Analyst | LinkedIn",
    querySelector: (s) => (selectors[s] ?? [])[0] ?? null,
    querySelectorAll: (s) => selectors[s] ?? [],
  };
  return {
    document,
    location: { href: url },
    URL,
    getComputedStyle: () => ({ overflowY: "visible" }),
  };
}

test("LinkedIn AI search cards are read through their own job id, page by page", async () => {
  const { runInNewContext } = await import("node:vm");
  const base =
    "https://www.linkedin.com/jobs/search-results/?keywords=Data%20Analyst&geoId=102454443";
  const pages = {
    0: aiSearchPage(
      base,
      [
        aiSearchCard("4479293626", "Data Analyst", "Cognizant", "新加坡 (混合办公)", {
          verified: true,
        }),
        aiSearchCard("4474803783", "Data Analyst", "SATS Ltd.", "新加坡"),
      ],
      [1, 2],
      1,
    ),
    25: aiSearchPage(
      `${base}&start=25`,
      [
        aiSearchCard("4467955217", "Data Analytics & Insights Engineer", "Dyson", "新加坡", {
          posted: "1 周前",
        }),
      ],
      [1, 2],
      2,
    ),
  };
  let start = 0;
  const driver = {
    navigate: async (url) => {
      start = Number(new URL(url).searchParams.get("start")) || 0;
    },
    waitForReady: async () => {},
    snapshot: async (script) => runInNewContext(script, pages[start]),
  };
  const result = await createLinkedInAdapter({ now: () => "2026-10-16T00:00:00.000Z" }).discover({
    source: getSourceById("sg-linkedin"),
    driver,
    task: {
      id: "ai-search",
      sourceId: "sg-linkedin",
      searchUrl: base,
      market: "SG",
      employmentType: "full_time",
    },
  });
  assert.deepEqual(
    result.jobs.map((job) => [job.title, job.company, job.location, job.url, job.postedText]),
    [
      [
        "Data Analyst",
        "Cognizant",
        "新加坡 (混合办公)",
        "https://www.linkedin.com/jobs/view/4479293626",
        "2 天前",
      ],
      [
        "Data Analyst",
        "SATS Ltd.",
        "新加坡",
        "https://www.linkedin.com/jobs/view/4474803783",
        "2 天前",
      ],
      [
        "Data Analytics & Insights Engineer",
        "Dyson",
        "新加坡",
        "https://www.linkedin.com/jobs/view/4467955217",
        "1 周前",
      ],
    ],
  );
  assert.equal(result.scan.pagesRead, 2);
  assert.equal(result.scan.complete, true);
  assert.equal(result.capability.authentication, "signed_in");
});

test("a LinkedIn AI search card without a well-formed id is not read", async () => {
  const { runInNewContext } = await import("node:vm");
  const url = "https://www.linkedin.com/jobs/search-results/?keywords=Data%20Analyst";
  const page = aiSearchPage(
    url,
    [
      aiSearchCard("not-a-number", "Data Analyst", "Example", "新加坡"),
      aiSearchCard("4479293626", "Data Analyst", "Cognizant", "新加坡"),
    ],
    [],
    1,
  );
  let script;
  await createLinkedInAdapter().inspect({
    driver: {
      snapshot: async (value) => {
        script = value;
        return {};
      },
    },
  });
  const snapshot = runInNewContext(script, page);
  assert.deepEqual(
    Array.from(snapshot.cards, (card) => card.url),
    ["https://www.linkedin.com/jobs/view/4479293626/"],
  );
  assert.equal(snapshot.pagination.endConfirmed, true);
});

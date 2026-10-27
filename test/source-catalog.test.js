import test from "node:test";
import assert from "node:assert/strict";

import { SOURCE_CATALOG, getMarketSources, getSourceById } from "../src/sources/catalog.js";
import { buildSearchPlan } from "../src/domain/jobs.js";

test("source catalog has unique safe records and eight to twelve sources per market", () => {
  assert.equal(new Set(SOURCE_CATALOG.map((source) => source.id)).size, SOURCE_CATALOG.length);
  for (const market of ["SG", "CN", "HK"]) {
    const sources = getMarketSources(market);
    assert.ok(sources.length >= 8 && sources.length <= 12, `${market} source count`);
    assert.ok(sources.filter((source) => source.defaultEnabled).length >= 3);
    for (const source of sources) {
      assert.equal(source.market, market);
      assert.ok(["direct", "login", "manual"].includes(source.access));
      assert.ok(
        ["general", "internship", "technology", "finance", "government"].includes(source.type),
      );
      const url = new URL(source.searchUrl("AI Engineer internship"));
      assert.ok(["http:", "https:"].includes(url.protocol));
      assert.ok(source.evidenceUrl.startsWith("https://"));
    }
  }
});

test("search plans include selected sources and exclude unselected sources", () => {
  const plan = buildSearchPlan({
    markets: ["SG"],
    roleTitles: ["AI Engineer"],
    employmentTypes: ["internship"],
    selectedSourceIds: ["sg-mcf", "sg-efc"],
  });
  assert.deepEqual([...new Set(plan.map((entry) => entry.sourceId))].sort(), ["sg-efc", "sg-mcf"]);
  assert.equal(
    plan.some((entry) => entry.sourceId === "sg-linkedin"),
    false,
  );
  assert.equal(getSourceById("sg-mcf").market, "SG");
});

test("a selected source from another market is rejected", () => {
  assert.throws(
    () =>
      buildSearchPlan({
        markets: ["SG"],
        roleTitles: ["Data Scientist"],
        employmentTypes: ["full_time"],
        selectedSourceIds: ["hk-jobsdb"],
      }),
    /does not belong/iu,
  );
});

test("Maimai is an assisted community lead source, not a native job reader", () => {
  const source = getSourceById("cn-maimai");
  assert.equal(source.access, "manual");
  assert.equal(source.adapterId, null);
  assert.equal(source.listingSupport, "assisted");
});

test("JIJIS remains an optional institutional portal instead of a general native reader", () => {
  const source = getSourceById("hk-jijis");
  assert.equal(source.access, "manual");
  assert.equal(source.adapterId, null);
  assert.equal(source.listingSupport, "assisted");
  assert.equal(source.defaultEnabled, false);
});

test("default search plans only use native readers with recorded live acceptance", () => {
  for (const market of ["SG", "CN", "HK"]) {
    const plan = buildSearchPlan({
      markets: [market],
      roleTitles: ["Data Analyst"],
      employmentTypes: ["full_time"],
    });
    assert.ok(plan.length > 0);
    for (const task of plan) {
      const source = getSourceById(task.sourceId);
      assert.ok(source.adapterId, `${source.name} must not silently require manual or AI browsing`);
      assert.equal(
        source.listingSupport,
        "tested",
        `${source.name} has no accepted native reading evidence`,
      );
      assert.ok(source.readingEvidence);
    }
  }
});

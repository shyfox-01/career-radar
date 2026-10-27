import test from "node:test";
import assert from "node:assert/strict";
import { scanPages } from "../src/sources/adapters/paginated-scan.js";

const job = (id) => ({
  url: `https://example.com/job/${id}`,
  title: `Role ${id}`,
  company: "Example",
});
test("reads subsequent pages and deduplicates records across page boundaries", async () => {
  const saved = [];
  const result = await scanPages({
    startUrl: "one",
    readPage: async (url) =>
      url === "one"
        ? { jobs: [job(1), job(2)], nextUrl: "two", completePage: true }
        : { jobs: [job(2), job(3)], nextUrl: null, completePage: true, endConfirmed: true },
    onProgress: async (p) => saved.push(p.scan.pagesRead),
  });
  assert.equal(result.jobs.length, 3);
  assert.deepEqual(saved, [1, 2]);
  assert.equal(result.scan.complete, true);
  assert.equal(result.scan.stopReason, "last_page");
});
test("a page cap retains the next-page cursor and does not claim completion", async () => {
  const result = await scanPages({
    startUrl: "one",
    maxPages: 1,
    readPage: async () => ({ jobs: [job(1)], nextUrl: "two", completePage: true }),
  });
  assert.equal(result.scan.complete, false);
  assert.equal(result.scan.nextUrl, "two");
  assert.equal(result.scan.stopReason, "page_limit");
});
test("a failure on page two retains page-one records and its retry cursor", async () => {
  const result = await scanPages({
    startUrl: "one",
    readPage: async (url) => {
      if (url === "two") throw Object.assign(Error("Sign in"), { code: "sign_in_required" });
      return { jobs: [job(1)], nextUrl: "two", completePage: true };
    },
  });
  assert.equal(result.jobs.length, 1);
  assert.equal(result.scan.nextUrl, "two");
  assert.equal(result.scan.stopReason, "sign_in_required");
  assert.equal(result.scan.complete, false);
});
test("repeated pages and unconfirmed endings are not marked complete", async () => {
  const repeated = await scanPages({
    startUrl: "one",
    readPage: async () => ({ jobs: [job(1)], nextUrl: "one", completePage: true }),
  });
  assert.equal(repeated.scan.stopReason, "pagination_loop");
  assert.equal(repeated.scan.complete, false);
  const unknown = await scanPages({
    startUrl: "one",
    readPage: async () => ({ jobs: [job(1)], completePage: true }),
  });
  assert.equal(unknown.scan.stopReason, "pagination_unavailable");
  assert.equal(unknown.scan.complete, false);
});
test("cancellation preserves a resumable cursor instead of discarding output", async () => {
  let cancelled = false;
  const result = await scanPages({
    startUrl: "one",
    shouldStop: () => cancelled,
    readPage: async () => ({ jobs: [job(1)], nextUrl: "two", completePage: true }),
    onProgress: async () => {
      cancelled = true;
    },
  });
  assert.equal(result.scan.stopReason, "cancelled");
  assert.equal(result.scan.nextUrl, "two");
  assert.equal(result.jobs.length, 1);
});

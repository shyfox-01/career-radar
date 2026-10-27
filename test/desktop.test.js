import test from "node:test";
import assert from "node:assert/strict";

import { classifyNavigation } from "../src/desktop/navigation.js";
import { resolveDesktopDataRoot } from "../src/desktop/paths.js";

test("classifyNavigation keeps the app origin internal", () => {
  assert.equal(
    classifyNavigation("http://127.0.0.1:4317/api/health", "http://127.0.0.1:4317"),
    "internal",
  );
});

test("classifyNavigation sends ordinary web links to the system browser", () => {
  assert.equal(
    classifyNavigation("https://example.test/job/42", "http://127.0.0.1:4317"),
    "external",
  );
});

test("classifyNavigation blocks local files, scripts, and invalid URLs", () => {
  for (const target of ["file:///C:/private.txt", "javascript:alert(1)", "not a URL"]) {
    assert.equal(classifyNavigation(target, "http://127.0.0.1:4317"), "blocked");
  }
});

test("desktop data uses an explicit override before every default", () => {
  assert.equal(
    resolveDesktopDataRoot({
      configuredRoot: "E:\\private-data",
      portableDirectory: "E:\\portable",
      userDataDirectory: "C:\\user-data",
    }),
    "E:\\private-data",
  );
});

test("portable builds keep their data beside the portable executable", () => {
  assert.equal(
    resolveDesktopDataRoot({
      portableDirectory: "E:\\CareerRadar",
      userDataDirectory: "C:\\user-data",
    }),
    "E:\\CareerRadar\\CareerRadarData",
  );
});

test("installed builds use the per-user application data directory", () => {
  assert.equal(
    resolveDesktopDataRoot({ userDataDirectory: "C:\\user-data" }),
    "C:\\user-data\\data",
  );
});

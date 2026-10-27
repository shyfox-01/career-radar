import test from "node:test";
import assert from "node:assert/strict";
import { classifyJobType } from "../src/sources/adapters/job-type.js";
test("listing evidence, not the requested search type, determines internship classification", () => {
  assert.equal(classifyJobType("Data Analyst"), "unknown");
  assert.equal(classifyJobType("International Analyst"), "unknown");
  assert.equal(classifyJobType("Data Analyst Intern"), "internship");
  assert.equal(classifyJobType("数据分析实习生"), "internship");
  assert.equal(classifyJobType("Analyst", "Full time"), "full_time");
  assert.equal(classifyJobType("Analyst", "Part-time"), "part_time");
});

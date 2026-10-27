import test from "node:test";
import assert from "node:assert/strict";

import { normalizeApprovedRoles, suggestRoles } from "../src/domain/roles.js";

test("different synthetic profiles receive different evidence-backed role rankings", () => {
  const ai = suggestRoles({
    resumeText:
      "Built Python LLM applications, machine learning pipelines, RAG, and data preprocessing.",
    preferences: {
      industries: ["FinTech"],
      roleInterests: ["AI Engineer", "Machine Learning Engineer"],
      emphasizedSkills: ["Python", "LLM", "RAG"],
      excludedWork: ["dashboard-only reporting"],
    },
    postingSupport: { ai_engineer: 18, machine_learning_engineer: 12 },
  });
  const product = suggestRoles({
    resumeText:
      "Defined product requirements, prioritized a roadmap, interviewed users, and analyzed adoption metrics.",
    preferences: {
      industries: ["Internet"],
      roleInterests: ["Product Manager"],
      emphasizedSkills: ["product strategy", "analytics"],
      excludedWork: [],
    },
    postingSupport: { product_manager: 15 },
  });

  assert.equal(ai[0].id, "ai_engineer");
  assert.equal(product[0].id, "product_manager");
  assert.notEqual(ai[0].id, product[0].id);
  assert.ok(ai[0].evidence.length > 0);
  assert.ok(product[0].evidence.some((item) => /preference|resume|posting/iu.test(item)));
  assert.equal(ai[0].selected, false);
});

test("role suggestions are deterministic, unique, and capped at twelve", () => {
  const input = {
    resumeText:
      "Python SQL machine learning data product finance operations research software cloud risk",
    preferences: {
      roleInterests: ["AI", "data", "product", "quant"],
      emphasizedSkills: ["Python", "SQL"],
      industries: ["finance", "technology"],
    },
    postingSupport: Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`role_${index}`, 30 - index]),
    ),
  };
  const first = suggestRoles(input);
  const second = suggestRoles(input);

  assert.deepEqual(first, second);
  assert.ok(first.length <= 12);
  assert.equal(new Set(first.map((role) => role.id)).size, first.length);
  assert.ok(first.every((role) => Number.isFinite(role.score) && role.evidence.length));
});

test("approved role titles are allowlisted, deduplicated, and capped at twenty", () => {
  const approved = normalizeApprovedRoles(["AI Engineer", " ai engineer ", "Data Scientist"]);
  assert.deepEqual(approved, ["AI Engineer", "Data Scientist"]);
  assert.throws(
    () => normalizeApprovedRoles(Array.from({ length: 21 }, (_, index) => `Role ${index}`)),
    /at most 20/iu,
  );
  assert.throws(() => normalizeApprovedRoles(["<script>alert(1)</script>"]), /unsupported/iu);
});

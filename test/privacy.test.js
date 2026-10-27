import test from "node:test";
import assert from "node:assert/strict";

import { redactResume } from "../src/domain/privacy.js";

test("redactResume removes common contact fields while preserving skills", () => {
  const input = [
    "Avery Tan",
    "avery.tan@example.com | +65 9123 4567",
    "linkedin.com/in/avery-tan github.com/averytan",
    "18 Example Road, Singapore 123456",
    "Python, SQL, PyTorch, product analytics",
  ].join("\n");

  const result = redactResume(input);

  assert.equal(result.text.includes("avery.tan@example.com"), false);
  assert.equal(result.text.includes("9123 4567"), false);
  assert.equal(result.text.includes("linkedin.com/in/avery-tan"), false);
  assert.equal(result.text.includes("18 Example Road"), false);
  assert.ok(result.text.includes("Python, SQL, PyTorch, product analytics"));
  assert.deepEqual(result.findings.map((finding) => finding.type).sort(), [
    "address",
    "email",
    "phone",
    "profile_url",
    "profile_url",
  ]);
});

test("redactResume rejects non-text input", () => {
  assert.throws(() => redactResume(null), /Resume text must be a string/);
});

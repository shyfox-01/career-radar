import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { deriveProviderState, validateProviderContract } from "../src/providers/provider.js";
import { createJsonFileRepository } from "../src/store/json-file.js";

test("provider state distinguishes missing, signed out, incompatible, and ready", () => {
  assert.equal(deriveProviderState({ installed: false }).state, "missing");
  assert.equal(deriveProviderState({ installed: true, authenticated: false }).state, "signed_out");
  assert.equal(
    deriveProviderState({ installed: true, authenticated: true, compatible: false }).state,
    "incompatible",
  );
  assert.equal(
    deriveProviderState({
      installed: true,
      authenticated: true,
      compatible: true,
      capabilities: { discovery: true },
    }).state,
    "ready",
  );
});

test("provider contract requires detection, status, capabilities, and discovery", () => {
  const complete = {
    id: "local",
    name: "Local",
    detect() {},
    status() {},
    capabilities() {},
    discover() {},
  };
  assert.equal(validateProviderContract(complete), complete);
  assert.throws(() => validateProviderContract({ ...complete, discover: undefined }), /discover/u);
  assert.throws(() => validateProviderContract({ ...complete, id: undefined }), /id and name/u);
});

test("JSON file repository round-trips and leaves no temporary file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "career-radar-json-"));
  try {
    const repository = createJsonFileRepository(path.join(root, "nested", "connections.json"));
    assert.deepEqual(await repository.load(), {});
    await repository.save({ "sg-jobstreet": { state: "connected" } });
    assert.deepEqual(await repository.load(), { "sg-jobstreet": { state: "connected" } });
    assert.match(await readFile(path.join(root, "nested", "connections.json"), "utf8"), /\n$/u);
    assert.deepEqual(await readdir(path.join(root, "nested")), ["connections.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

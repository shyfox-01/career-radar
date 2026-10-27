import test from "node:test";
import assert from "node:assert/strict";

import {
  createUnavailableSourceSessionController,
  sourceConnectionView,
} from "../src/sources/connections.js";
import { getSourceById } from "../src/sources/catalog.js";

test("login source view keeps authentication separate from extraction", () => {
  const view = sourceConnectionView(
    getSourceById("sg-linkedin"),
    {
      state: "connected",
      lastConfirmedAt: "2026-09-07T08:00:00.000Z",
      adapterId: "linkedin",
      authentication: "signed_in",
      extraction: "ready",
      lastProbedAt: "2026-09-07T08:00:00.000Z",
    },
    true,
  );

  assert.deepEqual(view, {
    sourceId: "sg-linkedin",
    name: "LinkedIn Jobs",
    market: "SG",
    state: "connected",
    desktopAvailable: true,
    extractionCapability: "automated",
    adapterId: "linkedin",
    authentication: "signed_in",
    extraction: "ready",
    lastProbedAt: "2026-09-07T08:00:00.000Z",
    lastSuccessfulExtractionAt: null,
    probeResultCount: null,
    scan: null,
    lastFailure: null,
    lastConfirmedAt: "2026-09-07T08:00:00.000Z",
    lastOpenedAt: null,
  });
});

test("source connection view rejects sources that do not require login", () => {
  assert.throws(
    () => sourceConnectionView(getSourceById("sg-mcf"), {}, true),
    /does not require login/iu,
  );
});

test("browser-only controller reports desktop required and refuses mutations", async () => {
  const controller = createUnavailableSourceSessionController();
  const views = await controller.list();
  assert.ok(views.length > 5);
  assert.ok(views.every((view) => view.state === "desktop_required"));
  await assert.rejects(() => controller.connect(getSourceById("cn-zhipin")), /packaged desktop/iu);
  await assert.rejects(() => controller.confirm("cn-zhipin"), /packaged desktop/iu);
  await assert.rejects(() => controller.probe("sg-linkedin"), /packaged desktop/iu);
  await assert.rejects(() => controller.discover([]), /packaged desktop/iu);
  await assert.rejects(() => controller.disconnect("cn-zhipin"), /packaged desktop/iu);
});

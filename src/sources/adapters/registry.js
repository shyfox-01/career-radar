import { validateSourceAdapter } from "./contract.js";
import { createLinkedInAdapter } from "./linkedin.js";
import { createPortalAdapter } from "./portal.js";
import { PORTAL_PROFILES } from "./portal-profiles.js";

export function createSourceAdapterRegistry(
  adapters = [
    createLinkedInAdapter(),
    ...Object.keys(PORTAL_PROFILES).map((id) => createPortalAdapter(id)),
  ],
) {
  const bySourceId = new Map();
  for (const candidate of adapters) {
    const adapter = validateSourceAdapter(candidate);
    for (const sourceId of adapter.sourceIds) {
      if (bySourceId.has(sourceId)) {
        throw new TypeError(`Multiple source adapters registered for ${sourceId}`);
      }
      bySourceId.set(sourceId, adapter);
    }
  }
  return Object.freeze({
    get(sourceId) {
      return bySourceId.get(sourceId) ?? null;
    },
    sourceIds() {
      return [...bySourceId.keys()].sort((left, right) => left.localeCompare(right, "en"));
    },
  });
}

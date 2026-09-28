import { describe, expect, it } from "vitest";

import { manifestRegistry } from "../manifests.js";

/**
 * The atom event contract is fixed by
 * `docs/design/flowengine/flow-engine-guide.md`. The orchestrator (and any
 * Liquid template) listens for these names; renaming them is a breaking
 * change. This spec keeps the manifests honest.
 */
describe("atom event contract", () => {
  const expectations: Record<string, readonly string[]> = {
    "zl-alert": ["zl-dismiss"],
    "zl-button": ["zl-submit"],
    "zl-card": [],
    "zl-checkbox": ["zl-change"],
    "zl-field": ["zl-input", "zl-submit"],
    "zl-icon": [],
    "zl-page-shell": [],
    "zl-passkey": ["zl-passkey-result", "zl-passkey-error", "zl-passkey-started"],
    "zl-pill": [],
    "zl-select": ["zl-change"],
  };

  for (const manifest of manifestRegistry) {
    it(`${manifest.tag} emits the documented events`, () => {
      const expected = expectations[manifest.tag];
      expect(expected, `missing expectation for ${manifest.tag}`).toBeDefined();
      expect([...manifest.events].sort()).toEqual([...(expected ?? [])].sort());
    });
  }

  it("uses zl-* event names exclusively", () => {
    for (const manifest of manifestRegistry) {
      for (const event of manifest.events) {
        expect(event.startsWith("zl-")).toBe(true);
      }
    }
  });
});

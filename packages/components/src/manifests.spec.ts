import { describe, expect, it } from "vitest";

import { findManifest, listKnownTags, manifestRegistry, type AtomManifest } from "./manifests.js";

describe("manifest registry", () => {
  it("exposes the documented atom set", () => {
    expect([...listKnownTags()].sort()).toEqual(
      [
        "zl-alert",
        "zl-button",
        "zl-card",
        "zl-checkbox",
        "zl-field",
        "zl-icon",
        "zl-page-shell",
        "zl-passkey",
        "zl-pill",
        "zl-select",
      ].sort(),
    );
  });

  it("has unique tags", () => {
    const tags = manifestRegistry.map((m: AtomManifest) => m.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("declares zl-* tag names", () => {
    for (const manifest of manifestRegistry) {
      expect(manifest.tag.startsWith("zl-")).toBe(true);
    }
  });

  it("returns a manifest from findManifest by tag", () => {
    const field = findManifest("zl-field");
    expect(field).toBeDefined();
    expect(field?.consumes?.field?.required).toBe(true);
  });

  it("returns undefined for unknown tags", () => {
    expect(findManifest("zl-mystery")).toBeUndefined();
  });

  it("declares zl-button as the (optional) submit action consumer", () => {
    const button = findManifest("zl-button");
    expect(button?.consumes?.action?.kind).toBe("submit");
    expect(button?.consumes?.action?.required).toBe(false);
    expect(button?.attrs).toContain("data-testid");
    expect(button?.events).toContain("zl-submit");
  });

  it("declares the documented zl-field public surface", () => {
    const field = findManifest("zl-field");
    expect(field?.attrs).toEqual(
      expect.arrayContaining([
        "name",
        "label",
        "type",
        "data-testid",
        "autocomplete",
        "required",
        "pattern",
        "success",
        "forgot-password-href",
        "forgot-password-label",
        "trailing-icon",
      ]),
    );
    expect(field?.parts).toEqual(
      expect.arrayContaining(["root", "label", "label-row", "forgot-link", "input", "error", "trailing-icon"]),
    );
    expect(field?.slots).toEqual(expect.arrayContaining(["prefix", "suffix", "help"]));
    expect(field?.events).toContain("zl-input");
  });

  it("declares the zl-passkey attribute surface used by default.liquid", () => {
    // `default.liquid` renders <zl-passkey ceremony method challenge-id options>;
    // every attribute the bundled template sets must be on the manifest so the
    // validator and editor tooling stay honest.
    const passkey = findManifest("zl-passkey");
    expect(passkey?.attrs).toEqual(
      expect.arrayContaining([
        "ceremony",
        "method",
        "challenge-id",
        "options",
        "manual",
        "pending-label",
        "cancel-label",
        "silent",
      ]),
    );
  });

  it("declares the default slot for atoms that project default content", () => {
    // Atoms rendering a bare <slot></slot> expose the default ("") slot as a
    // tier-3 override surface; keep the manifest in step with the markup.
    for (const tag of ["zl-alert", "zl-button", "zl-card", "zl-pill"]) {
      expect(findManifest(tag)?.slots, `${tag} default slot`).toContain("");
    }
  });

  it("has no duplicate entries in any manifest list", () => {
    for (const manifest of manifestRegistry) {
      for (const key of ["attrs", "parts", "slots", "events"] as const) {
        const list = manifest[key];
        expect(new Set(list).size, `${manifest.tag}.${key} has duplicates`).toBe(list.length);
      }
    }
  });
});

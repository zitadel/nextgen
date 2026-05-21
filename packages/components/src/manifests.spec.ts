import { describe, expect, it } from "vitest";

import { findManifest, listKnownTags, manifestRegistry, type AtomManifest } from "./manifests.js";

describe("manifest registry", () => {
  it("exposes the documented atom set", () => {
    expect([...listKnownTags()].sort()).toEqual(
      ["zl-alert", "zl-button", "zl-card", "zl-field", "zl-icon", "zl-page-shell", "zl-pill"].sort(),
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
    expect(button?.events).toContain("zl-submit");
  });

  it("declares the documented zl-field public surface", () => {
    const field = findManifest("zl-field");
    expect(field?.attrs).toEqual(
      expect.arrayContaining([
        "name",
        "label",
        "type",
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
});

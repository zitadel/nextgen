import { describe, expect, it } from "vitest";

import { findManifest, listKnownTags, manifestRegistry } from "./manifests.js";

describe("manifest registry", () => {
  it("exposes the documented atom set", () => {
    expect([...listKnownTags()].sort()).toEqual(
      ["zl-action", "zl-error", "zl-field", "zl-submit"].sort(),
    );
  });

  it("has unique tags", () => {
    const tags = manifestRegistry.map((m) => m.tag);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("declares zl-* tag names", () => {
    for (const manifest of manifestRegistry) {
      expect(manifest.tag.startsWith("zl-")).toBe(true);
    }
  });

  it("lists at least one part for every atom", () => {
    for (const manifest of manifestRegistry) {
      expect(manifest.parts.length).toBeGreaterThan(0);
      expect(manifest.parts).toContain("root");
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

  it("declares zl-submit as the primary action consumer", () => {
    const submit = findManifest("zl-submit");
    expect(submit?.consumes?.action?.kind).toBe("submit");
    expect(submit?.consumes?.action?.required).toBe(true);
  });

  it("declares the documented zl-field public surface", () => {
    const field = findManifest("zl-field");
    expect(field?.attrs).toEqual(
      expect.arrayContaining(["name", "label", "type", "autocomplete", "required", "pattern"]),
    );
    expect(field?.parts).toEqual(expect.arrayContaining(["root", "label", "input", "error"]));
    expect(field?.slots).toEqual(expect.arrayContaining(["prefix", "suffix", "help"]));
    expect(field?.events).toContain("zl-input");
  });

  it("declares zl-action as a non-gate consumer with zl-action event", () => {
    const action = findManifest("zl-action");
    expect(action?.satisfies_gate).toBeUndefined();
    expect(action?.events).toContain("zl-action");
  });
});

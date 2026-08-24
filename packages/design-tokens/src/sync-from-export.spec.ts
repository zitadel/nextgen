/**
 * Unit tests for the generic DTCG resolver (`scripts/sync-from-export.ts`).
 *
 * Guards the behaviour that the previous filename-coupled ingester lacked:
 *   - every export file is read (no silent filename filtering);
 *   - cross-collection and per-mode `{alias}` chains resolve to concrete values;
 *   - a concrete value wins over a same-path re-export alias;
 *   - unresolved references and empty colour surfaces fail loud;
 *   - roles come from `src/collections.ts`, never from a collection's shape. An
 *     unclassified export and a stale manifest entry are reported and caught
 *     here (a red check on the sync PR), not thrown during ingest; two
 *     collections reaching for the same output slot do still throw.
 *
 * It also runs the resolver against the real checked-in `figma-export/` files so
 * a future designer push that breaks resolution is caught here, not silently.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { syncTokens } from "../scripts/sync-from-export.js";
import { collectionRoles } from "./collections.js";

const leaf = (value: unknown, type = "color"): unknown => ({ $type: type, $value: value });

/** A minimal `semantic` collection, so tests can focus on one behaviour each. */
const mode = {
  name: "mode.json",
  data: {
    $metadata: { collection: "Mode", modes: ["Light", "Dark"] },
    Light: { base: { primary: leaf("#171717") } },
    Dark: { base: { primary: leaf("#e5e5e5") } },
  },
};

describe("syncTokens resolver", () => {
  it("resolves cross-collection and per-mode alias chains to concrete hex", () => {
    const out = syncTokens(
      [
        {
          name: "palette.json",
          data: { "tailwind colors": { neutral: { 900: leaf("#171717"), 200: leaf("#e5e5e5") } } },
        },
        {
          name: "theme.json",
          data: { colors: { "primary-light": leaf("{tailwind colors.neutral.900}"), "primary-dark": leaf("{tailwind colors.neutral.200}") } },
        },
        {
          name: "mode.json",
          data: {
            $metadata: { collection: "Mode", modes: ["Light", "Dark"] },
            Light: { base: { primary: leaf("{colors.primary-light}") } },
            Dark: { base: { primary: leaf("{colors.primary-dark}") } },
          },
        },
      ],
      // Registry-only collections still feed the alias chain — role controls
      // what a collection *surfaces*, not whether it can be referenced.
      { palette: "registry-only", theme: "registry-only", Mode: "semantic" },
    );

    expect(out.color.primary).toEqual({ dark: "#e5e5e5", light: "#171717" });
    expect(out.$source.themeModes).toEqual(["dark", "light"]);
  });

  it("flattens the base group and skips non-hex leaves", () => {
    const out = syncTokens(
      [
        {
          name: "mode.json",
          data: {
            $metadata: { collection: "Mode", modes: ["Light", "Dark"] },
            Light: { base: { "sidebar-accent": leaf("#ffffff"), enabled: leaf(true, "boolean") } },
            Dark: { base: { "sidebar-accent": leaf("#000000"), enabled: leaf(true, "boolean") } },
          },
        },
      ],
      { Mode: "semantic" },
    );

    expect(Object.keys(out.color)).toEqual(["sidebar-accent"]);
    expect(out.color["sidebar-accent"]).toEqual({ dark: "#000000", light: "#ffffff" });
  });

  it("lets a concrete value win over a same-path re-export alias", () => {
    const out = syncTokens(
      [
        { name: "1-primitive.json", data: { breakpoint: { sm: leaf(640, "number") } } },
        {
          name: "2-theme.json",
          data: {
            breakpoint: { sm: leaf("{breakpoint.sm}", "number") },
            $metadata: { collection: "Mode", modes: ["Light", "Dark"] },
            Light: { base: { ring: leaf("#a3a3a3") } },
            Dark: { base: { ring: leaf("#737373") } },
          },
        },
      ],
      { "1-primitive": "primitives", Mode: "semantic" },
    );

    // No cycle thrown; the concrete 640 wins, and the surface still builds.
    expect(out.color.ring).toEqual({ dark: "#737373", light: "#a3a3a3" });
  });

  it("throws on an unresolved reference", () => {
    expect(() =>
      syncTokens(
        [
          {
            name: "mode.json",
            data: {
              $metadata: { collection: "Mode", modes: ["Light", "Dark"] },
              Light: { base: { primary: leaf("{colors.missing}") } },
              Dark: { base: { primary: leaf("#000000") } },
            },
          },
        ],
        { Mode: "semantic" },
      ),
    ).toThrow(/Unresolved reference/);
  });

  // Reported, not thrown: `:sync-export` runs before the workflow opens the
  // sync PR, so throwing would kill the run with no check to go red. Failing
  // soft lands a reviewable PR; the assertions at the bottom of this file then
  // fail `full-pr` until someone classifies the collection.
  it("defaults an unclassified export to registry-only and reports it", () => {
    const out = syncTokens([mode, { name: "surprise.json", data: { thing: leaf("#ffffff") } }], { Mode: "semantic" });

    expect(out.$source.unclassifiedCollections).toEqual(["surprise"]);
    // registry-only: still resolvable as an alias, but surfaces nothing.
    expect(out.color.primary).toEqual({ dark: "#e5e5e5", light: "#171717" });
    expect(out.themed).toEqual({});
  });

  it("reports a manifest entry whose collection no longer exists", () => {
    expect(syncTokens([mode], { Mode: "semantic", Renamed: "themed" }).$source.staleCollectionRoles).toEqual(["Renamed"]);
  });

  it("requires exactly one semantic collection", () => {
    expect(() => syncTokens([mode], { Mode: "themed" })).toThrow(/Exactly one collection must have role "semantic"/);
    expect(() =>
      syncTokens(
        [
          mode,
          {
            name: "impostor.json",
            data: {
              $metadata: { collection: "Impostor", modes: ["Light", "Dark"] },
              Light: { base: { secondary: leaf("#ffffff") } },
              Dark: { base: { secondary: leaf("#000000") } },
            },
          },
        ],
        { Mode: "semantic", Impostor: "semantic" },
      ),
    ).toThrow(/Exactly one collection must have role "semantic" \(found 2/);
  });

  it("keeps every themed collection, namespaced by its own group", () => {
    const out = syncTokens(
      [
        mode,
        {
          name: "gradient-colors.json",
          data: {
            $metadata: { collection: "Gradient Colors", modes: ["Light", "Dark"] },
            Light: { gradient: { red: { start: leaf("#f25543") } } },
            Dark: { gradient: { red: { start: leaf("#e84331") } } },
          },
        },
        {
          name: "syntax.json",
          data: {
            $metadata: { collection: "Syntax", modes: ["Dark", "Light"] },
            Dark: { syntax: { key: leaf("#9066da") } },
            Light: { syntax: { key: leaf("#401889") } },
          },
        },
      ],
      { Mode: "semantic", "Gradient Colors": "themed", Syntax: "themed" },
    );

    // Both survive. When the role was inferred from "has Light/Dark modes",
    // these two shared the viewport bucket keyed by mode name, and whichever
    // file sorted last replaced the other outright.
    expect(out.themed.gradient).toEqual({ "red-start": { dark: "#e84331", light: "#f25543" } });
    expect(out.themed.syntax).toEqual({ key: { dark: "#9066da", light: "#401889" } });
    expect(out.typography).toEqual({});
    expect(out.color.primary).toEqual({ dark: "#e5e5e5", light: "#171717" });
  });

  it("throws when two themed collections project the same group", () => {
    expect(() =>
      syncTokens(
        [
          mode,
          {
            name: "a.json",
            data: {
              $metadata: { collection: "Syntax A", modes: ["Light", "Dark"] },
              Light: { syntax: { key: leaf("#401889") } },
              Dark: { syntax: { key: leaf("#9066da") } },
            },
          },
          {
            name: "b.json",
            data: {
              $metadata: { collection: "Syntax B", modes: ["Light", "Dark"] },
              Light: { syntax: { string: leaf("#bd2514") } },
              Dark: { syntax: { string: leaf("#f25543") } },
            },
          },
        ],
        { Mode: "semantic", "Syntax A": "themed", "Syntax B": "themed" },
      ),
    ).toThrow(/both project themed\.syntax/);
  });

  it("throws when two viewport collections project the same mode", () => {
    expect(() =>
      syncTokens(
        [
          mode,
          {
            name: "a.json",
            data: {
              $metadata: { collection: "Custom A", modes: ["Desktop", "Mobile"] },
              Desktop: { "heading-xl": { "font-size": leaf(60, "number") } },
              Mobile: { "heading-xl": { "font-size": leaf(36, "number") } },
            },
          },
          {
            name: "b.json",
            data: {
              $metadata: { collection: "Custom B", modes: ["Desktop", "Mobile"] },
              Desktop: { "heading-lg": { "font-size": leaf(48, "number") } },
              Mobile: { "heading-lg": { "font-size": leaf(30, "number") } },
            },
          },
        ],
        { Mode: "semantic", "Custom A": "viewport", "Custom B": "viewport" },
      ),
    ).toThrow(/both project typography\.desktop/);
  });
});

/**
 * The colour roles the generated surface must carry: shadcn's own set, plus the
 * additions this codebase consumes (`success` backs the user status badge).
 *
 * Asserted with `arrayContaining`, so the contract is one-directional by
 * design — **losing** a role fails, **gaining** one does not. A designer adding
 * a colour in Figma is routine and should not turn a sync PR red; the key
 * snapshot in `tokens.snapshot.spec.ts` is what records the addition for review.
 *
 * This replaced a bare `toHaveLength(33)`, which had the failure modes exactly
 * backwards: it went red on every harmless addition, yet stayed green on a swap
 * — drop `ring`, gain `success`, and the count never moves.
 */
const REQUIRED_COLOR_ROLES = [
  "accent",
  "accent-foreground",
  "background",
  "border",
  "card",
  "card-foreground",
  "chart-1",
  "chart-2",
  "chart-3",
  "chart-4",
  "chart-5",
  "destructive",
  "destructive-foreground",
  "foreground",
  "input",
  "muted",
  "muted-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "ring",
  "ring-offset",
  "secondary",
  "secondary-foreground",
  "sidebar",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-ring",
  "success",
];

describe("syncTokens against real figma-export/", () => {
  const exportDir = fileURLToPath(new URL("../figma-export", import.meta.url));
  const files = readdirSync(exportDir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((name) => ({ name, data: JSON.parse(readFileSync(`${exportDir}/${name}`, "utf8")) as unknown }));

  it("resolves the designer's exports into the full shadcn colour surface", () => {
    const out = syncTokens(files);

    expect(Object.keys(out.color)).toEqual(expect.arrayContaining(REQUIRED_COLOR_ROLES));
    expect(out.color.primary).toEqual({ dark: "#e5e5e5", light: "#171717" });
    expect(out.color.background).toEqual({ dark: "#050505", light: "#fafafa" });
    // Every surfaced colour resolved all the way to a concrete hex in both modes.
    for (const [name, { dark, light }] of Object.entries(out.color)) {
      expect(dark, name).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(light, name).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });

  it("surfaces every themed collection the designer pushed", () => {
    const out = syncTokens(files);

    expect(Object.keys(out.themed).sort()).toEqual(["gradient", "syntax"]);
    expect(Object.keys(out.themed.gradient!)).toHaveLength(6);
    expect(Object.keys(out.themed.syntax!)).toHaveLength(6);

    // The gradient stops that back the hand-written gradients in apps/console
    // AppShell, the atoms' zl-pill.css and layout-chrome.css.
    expect(out.themed.gradient!["red-start"]).toEqual({ dark: "#f25543", light: "#f25543" });
    expect(out.themed.gradient!["base-end"]).toEqual({ dark: "#0f0f11", light: "#fafafa" });
    expect(out.themed.gradient!["lavender-start"]).toEqual({ dark: "#bba5e4", light: "#bba5e4" });

    expect(out.themed.syntax!.key).toEqual({ dark: "#9066da", light: "#401889" });
  });

  it("keeps typography to the viewport axis", () => {
    expect(Object.keys(syncTokens(files).typography).sort()).toEqual(["desktop", "mobile"]);
  });

  // This is the gate. `:sync-export` reports rather than throws, so that a new
  // Figma collection still produces a reviewable PR — which means this test is
  // the only thing standing between an unclassified collection and a merge.
  it("classifies exactly the collections the export ships", () => {
    const { collections, unclassifiedCollections, staleCollectionRoles } = syncTokens(files).$source;

    expect(unclassifiedCollections, "add these to src/collections.ts").toEqual([]);
    expect(staleCollectionRoles, "renamed or removed in Figma; update src/collections.ts").toEqual([]);
    expect(Object.keys(collectionRoles).sort()).toEqual([...collections].sort());
  });
});

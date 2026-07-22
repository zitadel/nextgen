/**
 * Unit tests for the generic DTCG resolver (`scripts/sync-from-export.ts`).
 *
 * Guards the behaviour that the previous filename-coupled ingester lacked:
 *   - every export file is read (no silent filename filtering);
 *   - cross-collection and per-mode `{alias}` chains resolve to concrete values;
 *   - a concrete value wins over a same-path re-export alias;
 *   - unresolved references and empty colour surfaces fail loud.
 *
 * It also runs the resolver against the real checked-in `figma-export/` files so
 * a future designer push that breaks resolution is caught here, not silently.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { syncTokens } from "../scripts/sync-from-export.js";

const leaf = (value: unknown, type = "color"): unknown => ({ $type: type, $value: value });

describe("syncTokens resolver", () => {
  it("resolves cross-collection and per-mode alias chains to concrete hex", () => {
    const out = syncTokens([
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
    ]);

    expect(out.color.primary).toEqual({ dark: "#e5e5e5", light: "#171717" });
    expect(out.$source.themeModes).toEqual(["dark", "light"]);
  });

  it("flattens the base group and skips non-hex leaves", () => {
    const out = syncTokens([
      {
        name: "mode.json",
        data: {
          $metadata: { collection: "Mode", modes: ["Light", "Dark"] },
          Light: { base: { "sidebar-accent": leaf("#ffffff"), enabled: leaf(true, "boolean") } },
          Dark: { base: { "sidebar-accent": leaf("#000000"), enabled: leaf(true, "boolean") } },
        },
      },
    ]);

    expect(Object.keys(out.color)).toEqual(["sidebar-accent"]);
    expect(out.color["sidebar-accent"]).toEqual({ dark: "#000000", light: "#ffffff" });
  });

  it("lets a concrete value win over a same-path re-export alias", () => {
    const out = syncTokens([
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
    ]);

    // No cycle thrown; the concrete 640 wins, and the surface still builds.
    expect(out.color.ring).toEqual({ dark: "#737373", light: "#a3a3a3" });
  });

  it("throws on an unresolved reference", () => {
    expect(() =>
      syncTokens([
        {
          name: "mode.json",
          data: {
            $metadata: { collection: "Mode", modes: ["Light", "Dark"] },
            Light: { base: { primary: leaf("{colors.missing}") } },
            Dark: { base: { primary: leaf("#000000") } },
          },
        },
      ]),
    ).toThrow(/Unresolved reference/);
  });

  it("throws when no Light/Dark themed collection exists", () => {
    expect(() => syncTokens([{ name: "only-primitives.json", data: { spacing: { 1: leaf(4, "number") } } }])).toThrow(
      /No Light\/Dark themed collection/,
    );
  });
});

describe("syncTokens against real figma-export/", () => {
  const exportDir = fileURLToPath(new URL("../figma-export", import.meta.url));
  const files = readdirSync(exportDir)
    .filter((n) => n.endsWith(".json"))
    .sort()
    .map((name) => ({ name, data: JSON.parse(readFileSync(`${exportDir}/${name}`, "utf8")) as unknown }));

  it("resolves the designer's exports into the full shadcn colour surface", () => {
    const out = syncTokens(files);

    expect(Object.keys(out.color)).toHaveLength(33);
    expect(out.color.primary).toEqual({ dark: "#e5e5e5", light: "#171717" });
    expect(out.color.background).toEqual({ dark: "#050505", light: "#fafafa" });
    // Every surfaced colour resolved all the way to a concrete hex in both modes.
    for (const [name, { dark, light }] of Object.entries(out.color)) {
      expect(dark, name).toMatch(/^#[0-9a-f]{3,8}$/i);
      expect(light, name).toMatch(/^#[0-9a-f]{3,8}$/i);
    }
  });
});

/**
 * Builds the public token surfaces of `@zitadel/design-tokens` from:
 *   - `src/generated/figma.tokens.json` — resolved shadcn colours + container scale
 *   - `src/overrides.ts` — fonts, motion, focus, breakpoints, and the roles
 *     shadcn has no name for
 *
 * Emits four files into `src/generated/`:
 *
 *   tokens.css      — :root + [data-theme="dark"] + reserved
 *                     [data-theme="light"] selectors with `--zl-*` variables.
 *   tokens.ts       — typed `tokens` const + named groups for JS consumers.
 *   tailwind.css    — Tailwind v4 `@theme` block aliasing `--color-zl-*`,
 *                     `--spacing-zl-*` etc. so React consumers can write
 *                     `text-zl-text-primary` and `bg-zl-surface-black`.
 *   shadcn.css      — Tailwind v4 `@theme inline` mapping the standard shadcn
 *                     utility names (`bg-background`, `rounded-md`, `font-serif`)
 *                     onto `--zl-*`, so shadcn/ui components drop into the console.
 *
 * Run: `moon run design-tokens:generate`
 *
 * The output is intentionally deterministic — same JSON in, byte-identical
 * files out — so the sync-from-figma snapshot test catches drift cleanly.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import shadcnTokens from "../src/generated/figma.tokens.json" with { type: "json" };
import { overrides } from "../src/overrides.ts";

type Hex = string;
type Px = number;
type PrimitiveRef = { primitive: string };
type SemanticValue = Hex | PrimitiveRef;
/** A semantic colour that resolves differently per theme mode. */
type ModeValue = { dark: SemanticValue; light?: SemanticValue };
type ColorToken = SemanticValue | ModeValue;

/**
 * The new themed surface produced by `scripts/sync-from-export.ts` from the
 * designer's DTCG exports. Colours are shadcn-style semantic names, each with a
 * resolved `dark` and `light` hex.
 */
/** One `box-shadow` layer, camel-cased by `sync-from-export`. */
interface ShadowLayer {
  offsetX: Px;
  offsetY: Px;
  blurRadius: Px;
  spreadRadius: Px;
  color: Hex;
}

interface ShadcnTokensFile {
  $source: Record<string, unknown>;
  color: Record<string, { dark: Hex; light: Hex }>;
  /** The designer's `custom` group, keyed by raw Figma name — see `CUSTOM_ROLES`. */
  custom: Record<string, { dark: Hex; light: Hex }>;
  radius: Record<string, Px>;
  /** A step is one layer, or a numbered stack of them (`sm.1`, `sm.2`). */
  shadow: Record<string, ShadowLayer | Record<string, ShadowLayer>>;
  spacing: Record<string, Px>;
  text: Record<string, unknown>;
  fontFamily: Record<string, string>;
  fontWeight: Record<string, number>;
  /** Figma's `container/*` max-width scale in px (`sm`=384 … `7xl`=1280). */
  container: Record<string, Px>;
  /**
   * Light/Dark collections beyond the semantic surface — `syntax`, `gradient` —
   * namespaced by group. Emitted as `--zl-<group>-<name>` with a light override.
   */
  themed: Record<string, Record<string, { dark: Hex; light: Hex }>>;
  typography: Record<string, Record<string, unknown>>;
}

const shadcn = shadcnTokens as unknown as ShadcnTokensFile;
const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(ROOT, "../src/generated");

/** Convert a Figma slash path into the `--zl-*` CSS variable name. */
function cssVarName(category: string, ...segments: string[]): string {
  const parts = [category, ...segments]
    .join("/")
    .toLowerCase()
    .replaceAll(" ", "-")
    .replaceAll("/", "-");
  return `--zl-${parts}`;
}

function pxToRem(px: number): string {
  return `${px / 16}rem`;
}

/**
 * Semantic name -> the Figma `custom` variable it reads. Only roles something
 * actually consumes belong here; the group holds ~38 working variables and
 * publishing them all would put Figma's naming into our public surface.
 */
const CUSTOM_ROLES: Record<string, string> = {
  /** A control's own fill: nothing on a light page, a faint wash on a dark one. */
  "input-fill": "transparent dark:input\\30",
  /** The focus ring, at the opacity the design system draws it. */
  "ring-outline": "outline",
  /** The focus ring on an invalid control — heavier in dark, as shadcn draws it. */
  "destructive-ring": "destructive\\20 dark:destructive\\40",
};

/** `0 1px 2px 0 #0000000d` — one Figma shadow layer as a `box-shadow` term. */
function shadowLayer(layer: ShadowLayer): string {
  const lengths = [layer.offsetX, layer.offsetY, layer.blurRadius, layer.spreadRadius];
  return `${lengths.map((px) => `${px}px`).join(" ")} ${layer.color}`;
}

/**
 * A Figma shadow step is either one layer or a numbered stack of them
 * (`sm.1`, `sm.2`). CSS paints `box-shadow` first-term-on-top, and Figma
 * numbers its stack the same way, so the keys sort straight into term order.
 */
function composeBoxShadow(step: ShadowLayer | Record<string, ShadowLayer>): string {
  if ("offsetX" in step) return shadowLayer(step as ShadowLayer);
  return sortedNumeric(step as Record<string, ShadowLayer>)
    .map(([, layer]) => shadowLayer(layer))
    .join(", ");
}

/**
 * Document-level theme selectors, `:root`-qualified. See {@link emitCss} for
 * why the qualification matters — a bare `[data-theme]` reaches into the login
 * widget's host element and outranks its shadow styles.
 */
const DARK_ROOT_SELECTOR = ':root,\n:root[data-theme="dark"]';
const LIGHT_ROOT_SELECTOR = ':root[data-theme="light"]';

/** Generated banner so editors don't try to hand-edit the output. */
const BANNER = `/* AUTOGENERATED by packages/design-tokens/scripts/build.ts — do not edit by hand.\n   Source: src/generated/figma.tokens.json + src/overrides.ts.\n   Re-run: moon run design-tokens:generate */\n\n`;
const TS_BANNER = `// AUTOGENERATED by packages/design-tokens/scripts/build.ts — do not edit by hand.\n// Source: src/generated/figma.tokens.json + src/overrides.ts.\n// Re-run: moon run design-tokens:generate\n\n`;

interface BuildResult {
  css: string;
  ts: string;
  tailwind: string;
  shadcn: string;
}

function build(): BuildResult {
  /** [zl-var-name, resolved CSS value] tuples for `:root` (dark), in emit order. */
  const cssVars: Array<[string, string]> = [];
  /** [zl-var-name, resolved CSS value] tuples that differ under `[data-theme="light"]`. */
  const lightVars: Array<[string, string]> = [];
  // `theme.*` holds the new shadcn semantic colours; `color.*` stays the legacy
  // grouped surface so the two never collide (e.g. legacy `color.border.*`
  // group vs the new flat `theme.border`).
  /** Mirror structure for the typed TS `tokens` export (resolved dark values). */
  const tsTree: Record<string, unknown> = { color: {}, theme: {}, spacing: {}, radius: {}, font: {}, motion: {}, focus: {}, breakpoint: {}, container: {}, layout: {} };
  /** Mirror structure for the `cssVars` export — `var(--zl-…)` strings consumers compose into styles. */
  const refTree: Record<string, unknown> = { color: {}, theme: {}, spacing: {}, radius: {}, font: {}, motion: {}, focus: {}, breakpoint: {}, container: {}, layout: {} };

  const push = (cssVar: string, value: string, valuePath: string[], light?: string): void => {
    cssVars.push([cssVar, value]);
    if (light !== undefined && light !== value) lightVars.push([cssVar, light]);
    setDeep(tsTree, valuePath, value);
    setDeep(refTree, valuePath, `var(${cssVar})`);
  };

  /** `--zl-<shadcn-name>` vars, tracked separately so Tailwind can alias them as colours. */
  const shadcnColorVars: string[] = [];
  /**
   * `--zl-<group>-<name>` vars from the extra themed collections. Aliased as
   * Tailwind colours (`bg-zl-gradient-red-start`) but deliberately kept out of
   * `shadcn.css`: that file owns the *unprefixed* shadcn contract the console
   * authors against, and `syntax`/`gradient` are not shadcn role names.
   */
  const themedColorVars: string[] = [];

  // ---- semantic colours (themed; `:root`/dark = dark, `[data-theme="light"]` = light) ----
  for (const [name, { dark, light }] of Object.entries(shadcn.color)) {
    const cssVar = `--zl-${name}`;
    shadcnColorVars.push(cssVar);
    push(cssVar, dark, ["theme", toCamel(name)], light);
  }

  // ---- roles the shadcn set has no name for ----
  // `link` and `warning`: see `overrides.colorRole` for why each value is what
  // it is. Themed like every other colour so they flip with the mode.
  for (const [name, { dark, light }] of Object.entries(overrides.colorRole)) {
    const cssVar = `--zl-${name}`;
    shadcnColorVars.push(cssVar);
    push(cssVar, dark, ["theme", name], light);
  }

  // ---- spacing (in rem) ----
  // Tailwind's 4px ramp, which is what the design system lays out on. It
  // replaces the old `01`…`16` scale outright: that one was non-linear (`06`
  // and `04` were both 24px) and had no step for the 6/10/28/40px gaps the
  // frames use, so every atom would have had to reach for a raw rem value.
  // An empty ramp means the Tailwind collection was renamed in Figma and the
  // sync quietly projected nothing — every atom would fall back to no spacing
  // at all, which paints as a plausible-looking but wrong layout.
  if (Object.keys(shadcn.spacing).length === 0) {
    throw new Error(
      "figma.tokens.json has no spacing ramp. Check SPACING_COLLECTION in scripts/sync-from-export.ts " +
        "still names the collection Figma exports the `spacing/*` group from.",
    );
  }
  for (const [step, px] of sortedSpacing(shadcn.spacing)) {
    push(cssVarName("spacing", step), pxToRem(px), ["spacing", step]);
  }

  // ---- custom roles ----
  // Figma owns the per-mode values; build owns the name. These express a
  // behaviour no single `base` role can — a control fill that is transparent on
  // a light page but a faint wash on a dark one — and Figma spells that out in
  // the variable name itself (`transparent dark:input\30`), which is not a
  // usable CSS identifier. Same division of labour as the container roles below.
  for (const [role, figmaName] of Object.entries(CUSTOM_ROLES)) {
    const pair = shadcn.custom?.[figmaName];
    if (!pair) {
      throw new Error(
        `Figma custom role "${figmaName}" is missing from the export, so --zl-${role} cannot be emitted. ` +
          `Was it renamed? See CUSTOM_ROLES in this file.`,
      );
    }
    push(cssVarName(role), pair.dark, ["theme", toCamel(role)], pair.light);
  }

  // ---- corner radius (in rem) ----
  // One scale, the Figma one. The old `s`/`m`/`l` names are gone rather than
  // aliased: they were sized against a scale the design system no longer draws
  // with, and two live radius vocabularies is how the two drift apart.
  for (const [name, px] of Object.entries(shadcn.radius)) {
    push(cssVarName("radius", name), pxToRem(px), ["radius", toCamel(name)]);
  }
  push(cssVarName("radius", "full"), "9999px", ["radius", "full"]);

  // ---- type scale: font-size + line-height per step ----
  for (const [name, metrics] of Object.entries(shadcn.text)) {
    const { fontSize, lineHeight } = metrics as { fontSize: Px; lineHeight: Px };
    push(cssVarName("text", name, "size"), pxToRem(fontSize), ["text", toCamel(name), "size"]);
    push(cssVarName("text", name, "leading"), pxToRem(lineHeight), ["text", toCamel(name), "leading"]);
  }

  // ---- font weights ----
  for (const [name, weight] of Object.entries(shadcn.fontWeight)) {
    push(cssVarName("font-weight", name), String(weight), ["font", "weight", name]);
  }

  // ---- elevation ----
  for (const [name, step] of Object.entries(shadcn.shadow ?? {})) {
    push(cssVarName("shadow", name), composeBoxShadow(step), ["shadow", toCamel(name)]);
  }

  // ---- overrides: font ----
  for (const [name, value] of Object.entries(overrides.font.family)) {
    push(cssVarName("font-family", name), value, ["font", "family", name]);
  }

  // ---- overrides: motion ----
  for (const [name, value] of Object.entries(overrides.motion.duration)) {
    push(cssVarName("duration", name), value, ["motion", "duration", name]);
  }
  for (const [name, value] of Object.entries(overrides.motion.easing)) {
    push(cssVarName("easing", name), value, ["motion", "easing", name]);
  }

  // ---- overrides: focus ----
  push(cssVarName("focus", "width"), overrides.focus.width, ["focus", "width"]);
  push(cssVarName("focus", "offset"), overrides.focus.offset, ["focus", "offset"]);

  // ---- overrides: breakpoints ----
  for (const [name, value] of Object.entries(overrides.breakpoint)) {
    push(cssVarName("breakpoint", name), value, ["breakpoint", name]);
  }

  // ---- container max-widths: Zitadel semantic roles mapped onto Figma's `container/*` scale ----
  // Figma owns the pixel values; build owns which scale step each role uses.
  push(cssVarName("container", "auth-card"), pxToRem(containerStep("sm")), ["container", "authCard"]);
  push(cssVarName("container", "page"), pxToRem(containerStep("7xl")), ["container", "page"]);

  // ---- themed groups (syntax, gradient): themed like the shadcn colours, but
  // namespaced by group so they stay clear of both `--zl-color-*` and the flat
  // shadcn names. Emitted last so a new group appends to the generated diff.
  for (const [group, members] of Object.entries(shadcn.themed ?? {})) {
    for (const [name, { dark, light }] of Object.entries(members)) {
      const cssVar = cssVarName(group, name);
      themedColorVars.push(cssVar);
      push(cssVar, dark, [group, toCamel(name)], light);
    }
  }

  const css = emitCss(cssVars, lightVars);
  return {
    css,
    ts: emitTs(tsTree, refTree, css),
    tailwind: emitTailwind(cssVars, [...shadcnColorVars, ...themedColorVars]),
    shadcn: emitShadcn(shadcnColorVars),
  };
}

function setDeep(target: Record<string, unknown>, path: string[], value: string): void {
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i] ?? "";
    if (typeof cursor[key] !== "object" || cursor[key] === null) {
      cursor[key] = {};
    }
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[path[path.length - 1] ?? ""] = value;
}

/** Read a step from Figma's container scale, failing loud if the designer dropped it. */
function containerStep(name: string): Px {
  const px = shadcn.container?.[name];
  if (typeof px !== "number") {
    throw new Error(`figma.tokens.json is missing container.${name} — cannot emit the container max-width surface`);
  }
  return px;
}


/**
 * The theme selectors are `:root`-qualified on purpose.
 *
 * A bare `[data-theme="dark"]` matches *any* element carrying the attribute,
 * and `<zitadel-login>` stamps it on itself so its own shadow rules can key off
 * the resolved theme. On a page that imports this file, that made the
 * design-system defaults match the widget host directly — from the outer tree,
 * where a normal declaration outranks every `:host` rule in the shadow tree.
 * The result was that tenant branding silently painted nothing.
 *
 * Qualifying with `:root` keeps the document-level contract (an app flips
 * themes by setting `data-theme` on `<html>`, which is what `apps/console`
 * does) while leaving the widget host alone.
 */
function emitCss(vars: Array<[string, string]>, lightVars: Array<[string, string]>): string {
  const body = vars.map(([k, v]) => `  ${k}: ${v};`).join("\n");
  const root = `${DARK_ROOT_SELECTOR} {\n${body}\n}\n`;
  // Light mode only overrides the tokens that actually differ; everything
  // else inherits the dark `:root` values through the cascade.
  const lightBody = lightVars.map(([k, v]) => `  ${k}: ${v};`).join("\n");
  const light = lightVars.length
    ? `\n${LIGHT_ROOT_SELECTOR} {\n${lightBody}\n}\n`
    : `\n${LIGHT_ROOT_SELECTOR} {\n}\n`;
  return `${BANNER}${root}${light}`;
}

function emitTs(values: Record<string, unknown>, refs: Record<string, unknown>, css: string): string {
  // We embed the full CSS as a string export so consumers that can't pull
  // the raw .css file (a Lit shadow root, a Node test harness, an inline
  // <style> in an SSR'd page) still get the canonical base token layer.
  // The orchestrator uses this to seed a constructable stylesheet on its
  // own shadow root so atoms work even when the host page didn't
  // `@import` tokens.css.
  const body =
    `export const tokens = ${JSON.stringify(values, null, 2)} as const;\n\n` +
    `export const cssVars = ${JSON.stringify(refs, null, 2)} as const;\n\n` +
    `export const tokensCss = ${JSON.stringify(css)};\n\n` +
    // Exported so a consumer rewriting these blocks for a shadow root matches
    // on the same strings the emitter used. Hardcoding them on both sides is
    // how the rewrite silently stops matching when a selector changes.
    `export const THEME_SELECTORS = ${JSON.stringify(
      { dark: DARK_ROOT_SELECTOR, light: LIGHT_ROOT_SELECTOR },
      null,
      2,
    )} as const;\n\n` +
    `export type Tokens = typeof tokens;\nexport type CssVars = typeof cssVars;\n`;
  return `${TS_BANNER}${body}`;
}

/**
 * Tailwind v4 lets us declare a `@theme` block that aliases utility classes
 * to CSS variables. We prefix every alias with `zl-` so consumers writing
 * Tailwind in apps/console never collide with their own tokens, and so a
 * code reviewer can tell which classes come from the design system at a
 * glance (`bg-zl-surface-black` vs `bg-slate-900`).
 */
function emitTailwind(vars: Array<[string, string]>, colorVars: string[]): string {
  const lines: string[] = [];
  for (const [cssVar] of vars) {
    const utilityName = cssVar.replace(/^--zl-/, "");
    const mapped = mapToTailwindNamespace(utilityName);
    if (!mapped) continue;
    lines.push(`  --${mapped.prefix}-zl-${mapped.suffix}: var(${cssVar});`);
  }
  // Themed colours that carry no `--zl-<category>-` prefix of their own: the
  // shadcn roles (`--zl-background` -> `bg-zl-background`) and the themed
  // groups (`--zl-syntax-key` -> `text-zl-syntax-key`).
  for (const cssVar of colorVars) {
    const suffix = cssVar.replace(/^--zl-/, "");
    lines.push(`  --color-zl-${suffix}: var(${cssVar});`);
  }
  return `${BANNER}@import "./tokens.css";\n\n@theme {\n${lines.join("\n")}\n}\n`;
}

/**
 * Map a `{category}-{...}` name to its Tailwind v4 namespace prefix and
 * leftover suffix. Categories not listed here (focus, container) intentionally
 * fall through — consumers reach for the CSS variable directly.
 */
function mapToTailwindNamespace(utilityName: string): { prefix: string; suffix: string } | null {
  const knownCategories: Array<[string, string]> = [
    ["color-", "color"],
    ["spacing-", "spacing"],
    ["radius-", "radius"],
    ["font-family-", "font-family"],
    ["duration-", "duration"],
    ["easing-", "ease"],
    ["breakpoint-", "breakpoint"],
  ];
  for (const [match, prefix] of knownCategories) {
    if (utilityName.startsWith(match)) {
      return { prefix, suffix: utilityName.slice(match.length) };
    }
  }
  return null;
}

/**
 * The shadcn-flavoured view of the tokens. Maps the standard shadcn/ui utility
 * names (`bg-background`, `text-muted-foreground`, `border-border`, `rounded-md`,
 * `font-serif`) onto our canonical `--zl-*` variables via `@theme inline`, so
 * shadcn/ui registry components drop into `apps/console` unchanged and still
 * flip with `data-theme`. `--zl-*` stays the source of truth; this is a view.
 */
function emitShadcn(shadcnColorVars: string[]): string {
  const colors = shadcnColorVars.map((cssVar) => {
    const name = cssVar.replace(/^--zl-/, "");
    return `  --color-${name}: var(${cssVar});`;
  });
  // Alias rather than restate the pixel values: `tokens.css` now emits the same
  // Figma radius scale as `--zl-radius-*`, and two copies of a scale drift.
  const radii = Object.keys(shadcn.radius).map((name) => `  --radius-${name}: var(--zl-radius-${name});`);
  const shadows = Object.keys(shadcn.shadow ?? {}).map(
    (name) => `  --shadow-${name}: var(--zl-shadow-${name});`,
  );
  const fonts = [
    "  --font-sans: var(--zl-font-family-sans);",
    "  --font-serif: var(--zl-font-family-heading);",
    "  --font-mono: var(--zl-font-family-mono);",
  ];
  const body = [...colors, "", ...radii, "", ...shadows, "", ...fonts].join("\n");
  return `${BANNER}@import "./tokens.css";\n\n@theme inline {\n${body}\n}\n`;
}

function toCamel(s: string): string {
  return s.replace(/[-_/](.)/g, (_, ch) => ch.toUpperCase());
}
function sortedNumeric<V>(record: Record<string, V>): Array<[string, V]> {
  return Object.entries(record).sort(([a], [b]) => Number(a) - Number(b));
}

/**
 * Order the spacing ramp by the size it denotes. Steps are Tailwind's, so a
 * name is either a number, a halved number written with a dash (`2-5` = 2.5),
 * or the literal `px` — which is the smallest of the lot.
 */
function sortedSpacing<V>(record: Record<string, V>): Array<[string, V]> {
  const size = (step: string): number => (step === "px" ? 0.0625 : Number(step.replace("-", ".")));
  return Object.entries(record).sort(([a], [b]) => size(a) - size(b));
}

async function main(): Promise<void> {
  const result = build();
  await mkdir(OUT_DIR, { recursive: true });
  await Promise.all([
    writeFile(resolve(OUT_DIR, "tokens.css"), result.css),
    writeFile(resolve(OUT_DIR, "tokens.ts"), result.ts),
    writeFile(resolve(OUT_DIR, "tailwind.css"), result.tailwind),
    writeFile(resolve(OUT_DIR, "shadcn.css"), result.shadcn),
  ]);
  // eslint-disable-next-line no-console
  console.log(`design-tokens: wrote tokens.css, tokens.ts, tailwind.css, shadcn.css to ${OUT_DIR}`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

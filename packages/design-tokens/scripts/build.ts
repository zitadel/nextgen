/**
 * Builds the public token surfaces of `@zitadel/design-tokens` from:
 *   - `src/legacy.tokens.json` — frozen legacy `--zl-color-*` surface
 *   - `src/generated/figma.tokens.json` — resolved shadcn colours + container scale
 *   - `src/overrides.ts` — fonts, motion, focus, breakpoints, gray primitives
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
import legacyTokens from "../src/legacy.tokens.json" with { type: "json" };
import { overrides } from "../src/overrides.ts";

type Hex = string;
type Px = number;
type PrimitiveRef = { primitive: string };
type SemanticValue = Hex | PrimitiveRef;
/** A semantic colour that resolves differently per theme mode. */
type ModeValue = { dark: SemanticValue; light?: SemanticValue };
type ColorToken = SemanticValue | ModeValue;

/**
 * Frozen legacy source (`--zl-color-surface-*`, `--zl-color-text-*`, spacing,
 * radius, gray ramp). Kept verbatim so existing consumers keep working while
 * the new shadcn surface is migrated in — see design-tokens/README.md.
 */
interface LegacyTokensFile {
  $source: Record<string, unknown>;
  primitives: {
    color: Record<string, Hex | Record<string, Hex>>;
    spacing: Record<string, Px>;
    cornerRadius: Record<string, Px>;
  };
  /** Grid/layout primitives (columns, gutter, margin) owned by Figma's `layout/*` collection. */
  layout?: Record<string, number>;
  tokens: {
    color: Record<string, Record<string, ColorToken>>;
  };
}

/**
 * The new themed surface produced by `scripts/sync-from-export.ts` from the
 * designer's DTCG exports. Colours are shadcn-style semantic names, each with a
 * resolved `dark` and `light` hex.
 */
interface ShadcnTokensFile {
  $source: Record<string, unknown>;
  color: Record<string, { dark: Hex; light: Hex }>;
  radius: Record<string, Px>;
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

const figma = legacyTokens as unknown as LegacyTokensFile;
const shadcn = shadcnTokens as unknown as ShadcnTokensFile;
const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(ROOT, "../src/generated");

/** Resolve `{ "primitive": "color.gray.50" }` into the concrete hex. */
function resolvePrimitive(ref: PrimitiveRef): Hex {
  const parts = ref.primitive.split(".");
  let cursor: unknown = figma.primitives;
  for (const part of parts) {
    if (cursor === null || typeof cursor !== "object") {
      throw new Error(`Cannot descend into ${ref.primitive} at ${part}: parent is not an object`);
    }
    cursor = (cursor as Record<string, unknown>)[part];
    if (cursor === undefined) {
      throw new Error(`Primitive reference ${ref.primitive} not found (failed at ${part})`);
    }
  }
  if (typeof cursor !== "string") {
    throw new Error(`Primitive reference ${ref.primitive} did not resolve to a string`);
  }
  return cursor;
}

function resolveSemantic(value: SemanticValue): Hex {
  return typeof value === "string" ? value : resolvePrimitive(value);
}

function isModeValue(value: ColorToken): value is ModeValue {
  return typeof value === "object" && value !== null && "dark" in value;
}

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

/** Generated banner so editors don't try to hand-edit the output. */
const BANNER = `/* AUTOGENERATED by packages/design-tokens/scripts/build.ts — do not edit by hand.\n   Source: src/legacy.tokens.json + src/generated/figma.tokens.json + src/overrides.ts.\n   Re-run: moon run design-tokens:generate */\n\n`;
const TS_BANNER = `// AUTOGENERATED by packages/design-tokens/scripts/build.ts — do not edit by hand.\n// Source: src/legacy.tokens.json + src/generated/figma.tokens.json + src/overrides.ts.\n// Re-run: moon run design-tokens:generate\n\n`;

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

  // ---- legacy semantic colours (mode-aware: single value = mode-independent, {dark,light} = themed) ----
  for (const [group, members] of Object.entries(figma.tokens.color)) {
    for (const [name, raw] of Object.entries(members)) {
      const cssVar = cssVarName("color", group, name);
      const path = ["color", toCamel(group), toCamel(name)];
      if (isModeValue(raw)) {
        const light = raw.light !== undefined ? resolveSemantic(raw.light) : undefined;
        push(cssVar, resolveSemantic(raw.dark), path, light);
      } else {
        push(cssVar, resolveSemantic(raw), path);
      }
    }
  }

  // ---- new shadcn semantic colours (themed; `:root`/dark = dark, `[data-theme="light"]` = light) ----
  // Emitted as `--zl-<name>` so they never collide with the legacy `--zl-color-*`
  // namespace, letting both token systems coexist during migration.
  for (const [name, { dark, light }] of Object.entries(shadcn.color)) {
    const cssVar = `--zl-${name}`;
    shadcnColorVars.push(cssVar);
    push(cssVar, dark, ["theme", toCamel(name)], light);
  }

  // ---- primitive colours (re-exposed for atoms that need the raw shade) ----
  for (const [group, members] of Object.entries(overrides.colorPrimitive)) {
    for (const [name, value] of Object.entries(members)) {
      push(cssVarName("color", group, name), value, ["color", group, name]);
    }
  }

  // ---- semantic aliases (migration bridges) ----
  // Emitted AFTER the literals so the alias wins within each theme block.
  // References resolve against the theme-active value of the referenced
  // variable, so one declaration covers both modes — but the two legacy
  // names below also carry per-theme literals above, so the alias must land
  // in the light block too (hence the explicit lightVars append).
  //
  // 1. The legacy primary-accent pair now aliases the shadcn `primary`
  //    semantic: every consumer of the old names (primary button, checkbox
  //    checked state) follows the Figma `primary` values, while host-page
  //    overrides of EITHER name keep working — overriding the legacy name
  //    beats the alias, and overriding `--zl-primary` flows through it.
  // Keep these aliases CSS-only: `tokens` is the resolved-value API, while
  // `cssVars` already points consumers at the overridable custom properties.
  const aliasBoth = (cssVar: string, reference: string): void => {
    cssVars.push([cssVar, reference]);
    lightVars.push([cssVar, reference]);
  };
  aliasBoth("--zl-color-surface-default-white", "var(--zl-primary)");
  aliasBoth("--zl-color-text-button-default", "var(--zl-primary-foreground)");
  // 2. The link role: aliases the purple accent until Figma publishes a
  //    dedicated `link` semantic. `branding.palette.link` and host pages
  //    override this name to recolor exactly the link surfaces (card nav,
  //    forgot-password, field links). New name, no per-theme literal to
  //    shadow — a single :root declaration resolves per theme.
  const linkSource = figma.tokens.color.icon?.["default-purple"];
  if (linkSource === undefined) {
    throw new Error("legacy token color.icon.default-purple is required for the link alias");
  }
  cssVars.push(["--zl-color-text-link", "var(--zl-color-icon-default-purple)"]);
  setDeep(
    tsTree,
    ["color", "text", "link"],
    resolveSemantic(isModeValue(linkSource) ? linkSource.dark : linkSource),
  );
  setDeep(refTree, ["color", "text", "link"], "var(--zl-color-text-link)");

  // ---- spacing (in rem) — sorted by step number so 01..16 always emit in order ----
  for (const [step, px] of sortedNumeric(figma.primitives.spacing)) {
    push(cssVarName("spacing", step), pxToRem(px), ["spacing", step]);
  }

  // ---- corner radius (in rem) ----
  for (const [name, px] of Object.entries(figma.primitives.cornerRadius)) {
    push(cssVarName("radius", name), pxToRem(px), ["radius", name]);
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
  const focusColor = resolveFocusColor();
  push(cssVarName("focus", "color"), focusColor.dark, ["focus", "color"], focusColor.light);

  // ---- overrides: breakpoints ----
  for (const [name, value] of Object.entries(overrides.breakpoint)) {
    push(cssVarName("breakpoint", name), value, ["breakpoint", name]);
  }

  // ---- container max-widths: Zitadel semantic roles mapped onto Figma's `container/*` scale ----
  // Figma owns the pixel values; build owns which scale step each role uses.
  push(cssVarName("container", "auth-card"), pxToRem(containerStep("sm")), ["container", "authCard"]);
  push(cssVarName("container", "page"), pxToRem(containerStep("7xl")), ["container", "page"]);

  // ---- layout: grid columns / gutter / margin (columns unitless, spacing in rem) ----
  for (const [name, value] of Object.entries(figma.layout ?? {})) {
    const cssValue = name === "columns" ? String(value) : pxToRem(value);
    push(cssVarName("layout", name), cssValue, ["layout", name]);
  }

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
 * The focus ring reads its colour from a legacy semantic token, so it
 * inherits that token's theming: a ring the colour of dark-mode text would
 * be invisible on a light surface. Returns both modes when the source token
 * is mode-aware.
 */
function resolveFocusColor(): { dark: Hex; light?: Hex } {
  const parts = overrides.focus.colorToken.split("/").map((p) => p.trim().toLowerCase().replaceAll(" ", "-"));
  const [category, group, ...nameParts] = parts;
  if (category !== "color" || !group) {
    throw new Error(`overrides.focus.colorToken must look like "color/<group>/<name>", got ${overrides.focus.colorToken}`);
  }
  const groupTokens = figma.tokens.color[group];
  if (!groupTokens) {
    throw new Error(`overrides.focus.colorToken ${overrides.focus.colorToken} references unknown group ${group}`);
  }
  const name = nameParts.join("-");
  const raw = groupTokens[name];
  if (!raw) {
    throw new Error(`overrides.focus.colorToken ${overrides.focus.colorToken} not found in figma.tokens.json (group=${group}, name=${name})`);
  }
  if (isModeValue(raw)) {
    return {
      dark: resolveSemantic(raw.dark),
      light: raw.light !== undefined ? resolveSemantic(raw.light) : undefined,
    };
  }
  return { dark: resolveSemantic(raw) };
}

function emitCss(vars: Array<[string, string]>, lightVars: Array<[string, string]>): string {
  const body = vars.map(([k, v]) => `  ${k}: ${v};`).join("\n");
  const root = `:root,\n[data-theme="dark"] {\n${body}\n}\n`;
  // Light mode only overrides the tokens that actually differ; everything
  // else inherits the dark `:root` values through the cascade.
  const lightBody = lightVars.map(([k, v]) => `  ${k}: ${v};`).join("\n");
  const light = lightVars.length
    ? `\n[data-theme="light"] {\n${lightBody}\n}\n`
    : `\n[data-theme="light"] {\n}\n`;
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
  const radii = Object.entries(shadcn.radius).map(([name, px]) => `  --radius-${name}: ${pxToRem(px)};`);
  const fonts = [
    "  --font-sans: var(--zl-font-family-sans);",
    "  --font-serif: var(--zl-font-family-heading);",
    "  --font-mono: var(--zl-font-family-mono);",
  ];
  const body = [...colors, "", ...radii, "", ...fonts].join("\n");
  return `${BANNER}@import "./tokens.css";\n\n@theme inline {\n${body}\n}\n`;
}

function toCamel(s: string): string {
  return s.replace(/[-_/](.)/g, (_, ch) => ch.toUpperCase());
}
function sortedNumeric<V>(record: Record<string, V>): Array<[string, V]> {
  return Object.entries(record).sort(([a], [b]) => Number(a) - Number(b));
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

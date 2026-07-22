/**
 * Generic token sync from the designer's DTCG JSON exports under `figma-export/`.
 *
 *   moon run design-tokens:sync-export
 *
 * The Figma Community sync plugin pushes W3C DTCG JSON to
 * `packages/design-tokens/figma-export/` on branch `design-tokens/figma-sync`.
 *
 * This ingester is intentionally *file-name agnostic*. It reads every `*.json`
 * export, builds one global registry of leaf values keyed by their dotted path,
 * resolves every `{alias}` (including cross-collection and cross-mode chains)
 * down to a concrete hex/number/string, and then projects the resolved graph
 * onto the surface `build.ts` consumes.
 *
 * Fail-loud contract: if any leaf fails to resolve, or if the themed colour
 * surface comes out empty, the script throws. Silently dropping a designer's
 * variables (the previous filename-coupled behaviour) is treated as a bug, not
 * a warning.
 *
 * Collection detection is by *shape*, not file name:
 *   - the multi-mode collection whose modes include Light + Dark is the themed
 *     semantic colour surface (its leaves become `color.<name> = {dark,light}`);
 *   - any other multi-mode collection is treated as viewport typography
 *     (its leaves become `typography.<mode>.<name>`);
 *   - single-mode collections contribute primitives, surfaced by group name
 *     (`radius`, `text`, `font`, `font-weight`).
 */
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = resolve(ROOT, "../figma-export");
const TOKENS_FILE = resolve(ROOT, "../src/generated/figma.tokens.json");

/** Single flat "mode" bucket for collections that declare no modes. */
const NO_MODE = "*";

type Raw = string | number | boolean;
interface DtcgLeaf {
  $type?: string;
  $value: Raw | { hex: string };
}

interface ParsedCollection {
  /** File name (diagnostics only — never used for behaviour). */
  file: string;
  /** Collection name from `$metadata.collection`, or the file stem. */
  name: string;
  /** Declared mode names, or `[NO_MODE]` for single-mode collections. */
  modes: string[];
  /** Per-mode flattened leaves: mode -> (dotted path -> raw value). */
  leaves: Map<string, Map<string, Raw>>;
}

function isLeaf(node: unknown): node is DtcgLeaf {
  return typeof node === "object" && node !== null && "$value" in node;
}

function leafRaw(leaf: DtcgLeaf, path: string): Raw {
  const value = leaf.$value;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object" && value !== null && "hex" in value) {
    return String(value.hex).toLowerCase();
  }
  throw new Error(`Unsupported $value at ${path}: ${JSON.stringify(value)}`);
}

/** Collect every DTCG leaf under `node` into `out`, keyed by dotted path. */
function flatten(node: unknown, prefix: string, out: Map<string, Raw>): void {
  if (isLeaf(node)) {
    out.set(prefix, leafRaw(node, prefix));
    return;
  }
  if (typeof node !== "object" || node === null) return;
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    flatten(child, prefix ? `${prefix}.${key}` : key, out);
  }
}

function parseCollection(file: string, raw: unknown): ParsedCollection {
  const root = raw as Record<string, unknown>;
  const metadata = root.$metadata as { collection?: string; modes?: string[] } | undefined;
  const name = metadata?.collection ?? file.replace(/\.json$/, "");
  const declaredModes = metadata?.modes;

  const leaves = new Map<string, Map<string, Raw>>();
  if (declaredModes && declaredModes.length > 0) {
    for (const mode of declaredModes) {
      const modeLeaves = new Map<string, Raw>();
      flatten(root[mode], "", modeLeaves);
      leaves.set(mode, modeLeaves);
    }
    return { file, name, modes: declaredModes, leaves };
  }

  const modeLeaves = new Map<string, Raw>();
  flatten(root, "", modeLeaves);
  // Drop the empty-prefix key that a bare `$metadata`-less root can produce.
  modeLeaves.delete("");
  leaves.set(NO_MODE, modeLeaves);
  return { file, name, modes: [NO_MODE], leaves };
}

const ALIAS = /^\{(.+)\}$/;

function isAliasValue(value: Raw): boolean {
  return typeof value === "string" && ALIAS.test(value);
}

/**
 * Global resolver over every collection's leaves. A reference `{a.b.c}` is
 * looked up as path `a.b.c` in the requested mode, falling back to the
 * mode-independent (`NO_MODE`) value, then to a lone value if the path exists
 * in exactly one mode. Resolution recurses until it reaches a concrete value.
 */
class Registry {
  /** path -> (mode -> raw) across all collections. */
  private readonly index = new Map<string, Map<string, Raw>>();

  add(path: string, mode: string, value: Raw): void {
    let byMode = this.index.get(path);
    if (!byMode) {
      byMode = new Map();
      this.index.set(path, byMode);
    }
    const existing = byMode.get(mode);
    if (existing === undefined || existing === value) {
      byMode.set(mode, value);
      return;
    }
    // Two collections share a group name (e.g. both a primitive collection and
    // the theme collection expose `breakpoint/*`). A concrete value always wins
    // over a re-export alias; two conflicting *concrete* values are a genuine
    // ambiguity we refuse to guess through.
    const existingAlias = isAliasValue(existing);
    const incomingAlias = isAliasValue(value);
    if (existingAlias && !incomingAlias) {
      byMode.set(mode, value);
      return;
    }
    if (!existingAlias && incomingAlias) return;
    if (!existingAlias && !incomingAlias) {
      throw new Error(
        `Conflicting definitions for ${path} (mode ${mode}): ${JSON.stringify(existing)} vs ${JSON.stringify(value)}`,
      );
    }
    // Two differing aliases for the same path: keep the first deterministically.
  }

  private lookup(path: string, mode: string): Raw {
    const byMode = this.index.get(path);
    if (!byMode) throw new Error(`Unresolved reference: {${path}}`);
    if (byMode.has(mode)) return byMode.get(mode)!;
    if (byMode.has(NO_MODE)) return byMode.get(NO_MODE)!;
    if (byMode.size === 1) return [...byMode.values()][0]!;
    throw new Error(
      `Ambiguous reference {${path}} in mode ${mode}: defined for modes [${[...byMode.keys()].join(", ")}]`,
    );
  }

  resolve(path: string, mode: string, seen: Set<string> = new Set()): Raw {
    const key = `${mode}::${path}`;
    if (seen.has(key)) {
      throw new Error(`Alias cycle at {${path}} (mode ${mode})`);
    }
    seen.add(key);
    const raw = this.lookup(path, mode);
    if (typeof raw === "string") {
      const match = raw.match(ALIAS);
      if (match) return this.resolve(match[1]!.trim(), mode, seen);
    }
    return raw;
  }
}

function kebab(segments: string[]): string {
  return segments.join("-").toLowerCase().replace(/\s+/g, "-");
}

function isThemeCollection(c: ParsedCollection): boolean {
  const lower = c.modes.map((m) => m.toLowerCase());
  return lower.includes("light") && lower.includes("dark");
}

function findMode(c: ParsedCollection, wanted: string): string {
  const found = c.modes.find((m) => m.toLowerCase() === wanted);
  if (!found) throw new Error(`Collection ${c.name} has no ${wanted} mode`);
  return found;
}

const HEX = /^#[0-9a-f]{3,8}$/i;
/**
 * The designer keeps the consumer-facing semantic colours under the `base`
 * group; the rest of the themed collection is scratch/working variables. Build
 * `color.<name> = {dark,light}` from the `base` group only, skipping any leaf
 * that does not resolve to a hex colour.
 */
function buildColorSurface(theme: ParsedCollection, registry: Registry): Record<string, { dark: string; light: string }> {
  const lightMode = findMode(theme, "light");
  const darkMode = findMode(theme, "dark");
  const paths = [...theme.leaves.get(lightMode)!.keys()];
  const basePaths = paths.filter((p) => p.startsWith("base."));
  const surface = basePaths.length > 0 ? basePaths : paths;
  const out: Record<string, { dark: string; light: string }> = {};
  for (const path of surface) {
    const dark = String(registry.resolve(path, darkMode));
    const light = String(registry.resolve(path, lightMode));
    if (!HEX.test(dark) || !HEX.test(light)) continue;
    // `base.sidebar-accent` -> `sidebar-accent`; `base.chart-1` -> `chart-1`.
    const name = kebab(path.split(".").slice(1));
    out[name] = { dark, light };
  }
  return out;
}

/** Nest a dotted path into `target`, camel-casing each segment. */
function setNested(target: Record<string, unknown>, path: string, value: Raw): void {
  const parts = path.split(".").map((p) => p.replace(/-([a-z0-9])/g, (_, ch: string) => ch.toUpperCase()));
  let cursor = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i]!;
    if (typeof cursor[key] !== "object" || cursor[key] === null) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1]!] = value;
}

/** Project a single-mode group (e.g. `radius`, `text`) into a resolved tree. */
function buildGroup(group: string, singleMode: Map<string, Raw>, registry: Registry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const prefix = `${group}.`;
  for (const path of singleMode.keys()) {
    if (!path.startsWith(prefix)) continue;
    setNested(out, path.slice(prefix.length), registry.resolve(path, NO_MODE));
  }
  return out;
}

export interface SyncedTokens {
  $source: {
    libraryName: string;
    generatedBy: string;
    collections: string[];
    themeModes: string[];
    resolvedLeaves: number;
  };
  color: Record<string, { dark: string; light: string }>;
  radius: Record<string, unknown>;
  text: Record<string, unknown>;
  fontFamily: Record<string, unknown>;
  fontWeight: Record<string, unknown>;
  typography: Record<string, Record<string, unknown>>;
}

/**
 * Pure core of the sync: takes the raw parsed contents of every export file and
 * returns the resolved token surface. Kept separate from `main()` so it can be
 * unit-tested against the checked-in fixture without touching the filesystem.
 */
export function syncTokens(files: Array<{ name: string; data: unknown }>): SyncedTokens {
  if (files.length === 0) throw new Error("No JSON exports provided");

  const collections = files.map(({ name, data }) => parseCollection(name, data));

  // One registry across all collections so aliases resolve cross-file.
  const registry = new Registry();
  for (const c of collections) {
    for (const [mode, leaves] of c.leaves) {
      for (const [path, value] of leaves) registry.add(path, mode, value);
    }
  }

  // Fail-loud: prove every leaf resolves in every mode it is declared for.
  let resolvedLeaves = 0;
  for (const c of collections) {
    for (const [mode, leaves] of c.leaves) {
      for (const path of leaves.keys()) {
        registry.resolve(path, mode);
        resolvedLeaves += 1;
      }
    }
  }
  if (resolvedLeaves === 0) throw new Error("No token leaves ingested from exports");

  const themeCollection = collections.find(isThemeCollection);
  if (!themeCollection) {
    throw new Error("No Light/Dark themed collection found in exports (cannot build colour surface)");
  }
  const color = buildColorSurface(themeCollection, registry);
  if (Object.keys(color).length === 0) {
    throw new Error(`Themed collection ${themeCollection.name} produced no colours`);
  }

  // Merge every single-mode collection's leaves so we can surface primitive
  // groups (radius/text/font) by group name regardless of which file they came from.
  const singleMode = new Map<string, Raw>();
  for (const c of collections) {
    const flat = c.leaves.get(NO_MODE);
    if (flat) for (const [path, value] of flat) singleMode.set(path, value);
  }

  // Viewport typography: any multi-mode collection that isn't the theme surface.
  const typography: Record<string, Record<string, unknown>> = {};
  for (const c of collections) {
    if (c === themeCollection || c.modes[0] === NO_MODE) continue;
    for (const mode of c.modes) {
      const modeOut: Record<string, unknown> = {};
      for (const path of c.leaves.get(mode)!.keys()) {
        setNested(modeOut, path, registry.resolve(path, mode));
      }
      typography[mode.toLowerCase()] = modeOut;
    }
  }

  return {
    $source: {
      libraryName: "Zitadel - Design System - External",
      generatedBy: "scripts/sync-from-export.ts",
      collections: collections.map((c) => c.name),
      themeModes: ["dark", "light"],
      resolvedLeaves,
    },
    color,
    radius: buildGroup("radius", singleMode, registry),
    text: buildGroup("text", singleMode, registry),
    fontFamily: buildGroup("font", singleMode, registry),
    fontWeight: buildGroup("font-weight", singleMode, registry),
    typography,
  };
}

async function main(): Promise<void> {
  try {
    await access(EXPORT_DIR);
  } catch {
    throw new Error(
      `Export directory not found: ${EXPORT_DIR}. Configure the Figma plugin to push DTCG JSON to packages/design-tokens/figma-export on branch design-tokens/figma-sync.`,
    );
  }

  const names = (await readdir(EXPORT_DIR)).filter((n) => n.endsWith(".json")).sort();
  if (names.length === 0) throw new Error(`No JSON exports found in ${EXPORT_DIR}`);

  const files = await Promise.all(
    names.map(async (name) => ({
      name,
      data: JSON.parse(await readFile(resolve(EXPORT_DIR, name), "utf8")) as unknown,
    })),
  );

  const out = syncTokens(files);
  await writeFile(TOKENS_FILE, `${JSON.stringify(out, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(
    `design-tokens sync-export: resolved ${out.$source.resolvedLeaves} leaves across ${out.$source.collections.length} collections; ` +
      `surfaced ${Object.keys(out.color).length} colours -> ${TOKENS_FILE}`,
  );
  // eslint-disable-next-line no-console
  console.warn("Now run `moon run design-tokens:generate` and review the tokens.snapshot.spec.ts diff.");
}

// Only run the filesystem sync when invoked directly (`tsx sync-from-export.ts`),
// not when imported by the unit test.
if (argv[1] && import.meta.url === pathToFileURL(argv[1]).href) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}

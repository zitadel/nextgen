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
 * What each collection *is* is declared in `src/collections.ts`, not inferred
 * from its shape. Inference is what let `Gradient Colors` and `Syntax` — two
 * collections that merely happen to share Light/Dark modes — land in the same
 * bucket, where one silently replaced the other.
 *
 * An unclassified export defaults to `registry-only` and is reported in
 * `$source.unclassifiedCollections`; a stale manifest entry lands in
 * `$source.staleCollectionRoles`. Both are caught by `sync-from-export.spec.ts`,
 * i.e. by a red check on the sync PR — *not* by throwing here, which would kill
 * the workflow before it ever opens a PR to put a check on.
 */
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { type CollectionRole, collectionRoles } from "../src/collections.js";

const ROOT = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = resolve(ROOT, "../figma-export");
const TOKENS_FILE = resolve(ROOT, "../src/generated/figma.tokens.json");

/** Single flat "mode" bucket for collections that declare no modes. */
const NO_MODE = "*";

/** Collection that owns the `spacing/*` layout ramp. See its projection below. */
const SPACING_COLLECTION = "1--tailwindcss";

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

/**
 * Bind every parsed collection to its declared role.
 *
 * A collection the manifest does not name falls back to `registry-only` — the
 * conservative role, surfacing nothing — and is reported in `$source`. It is
 * deliberately *not* a throw: `:sync-export` runs before the workflow opens or
 * updates the sync PR, so throwing here kills the run without ever producing a
 * red check, and the only trace is a workflow log nobody reads. Failing soft
 * lets the exports land as a reviewable PR; `sync-from-export.spec.ts` then
 * fails `full-pr` until someone classifies them, which is a signal that shows
 * up where the work actually is.
 *
 * A manifest entry with no matching export is reported the same way — it means
 * a collection was renamed or removed in Figma and the manifest is now stale.
 */
function assignRoles(
  collections: ParsedCollection[],
  roles: Record<string, CollectionRole>,
): { assigned: Map<ParsedCollection, CollectionRole>; unclassified: string[]; stale: string[] } {
  const assigned = new Map<ParsedCollection, CollectionRole>();
  const unclassified: string[] = [];
  for (const c of collections) {
    const role = roles[c.name];
    if (role === undefined) unclassified.push(c.name);
    assigned.set(c, role ?? "registry-only");
  }
  const stale = Object.keys(roles).filter((name) => !collections.some((c) => c.name === name));
  return { assigned, unclassified, stale };
}

/** The collections holding a given role, in export order. */
function withRole(
  assigned: Map<ParsedCollection, CollectionRole>,
  role: CollectionRole,
): ParsedCollection[] {
  return [...assigned].filter(([, r]) => r === role).map(([c]) => c);
}

/** The single collection that owns `color.*`. */
function semanticCollection(assigned: Map<ParsedCollection, CollectionRole>): ParsedCollection {
  const found = withRole(assigned, "semantic");
  if (found.length !== 1) {
    throw new Error(
      `Exactly one collection must have role "semantic" (found ${found.length}` +
        `${found.length > 0 ? `: ${found.map((c) => c.name).join(", ")}` : ""}). See src/collections.ts.`,
    );
  }
  return found[0]!;
}

function findMode(c: ParsedCollection, wanted: string): string {
  const found = c.modes.find((m) => m.toLowerCase() === wanted);
  if (!found) throw new Error(`Collection ${c.name} has no ${wanted} mode`);
  return found;
}

/** The leaves a collection declared for `wanted` (`"light"`, `"dark"`). */
function leavesForMode(c: ParsedCollection, wanted: string): Map<string, Raw> {
  const leaves = c.leaves.get(findMode(c, wanted));
  if (!leaves) throw new Error(`Collection ${c.name} declared a ${wanted} mode but exported no leaves for it`);
  return leaves;
}

const HEX = /^#[0-9a-f]{3,8}$/i;

export interface ThemedColor {
  dark: string;
  light: string;
}

/**
 * Assign `value` to `slot`, or throw if another collection already holds it.
 * Roles keep two collections out of each other's *bucket*; this keeps two
 * collections in the same bucket out of each other's *key*.
 */
function claim<T>(
  into: Record<string, T>,
  owners: Map<string, string>,
  key: string,
  label: string,
  owner: string,
  value: T,
): void {
  const existing = owners.get(key);
  if (existing !== undefined) {
    throw new Error(
      `Collections "${existing}" and "${owner}" both project ${label}. Refusing to overwrite — ` +
        `namespace one of them in Figma so both survive the sync.`,
    );
  }
  owners.set(key, owner);
  into[key] = value;
}

/**
 * Resolve `{path, name}` entries of a Light/Dark collection into `{dark,light}`
 * hex pairs. Leaves that do not resolve to a hex in both modes are returned as
 * `skipped` rather than dropped on the floor, so callers can account for them.
 */
function resolveThemedPairs(
  c: ParsedCollection,
  registry: Registry,
  entries: Array<{ path: string; name: string }>,
): { pairs: Record<string, ThemedColor>; skipped: string[] } {
  const lightMode = findMode(c, "light");
  const darkMode = findMode(c, "dark");
  const pairs: Record<string, ThemedColor> = {};
  const skipped: string[] = [];
  for (const { path, name } of entries) {
    const dark = String(registry.resolve(path, darkMode));
    const light = String(registry.resolve(path, lightMode));
    if (!HEX.test(dark) || !HEX.test(light)) {
      skipped.push(path);
      continue;
    }
    pairs[name] = { dark, light };
  }
  return { pairs, skipped };
}

/**
 * The designer keeps the consumer-facing semantic colours under the `base`
 * group; the rest of the themed collection is scratch/working variables. Build
 * `color.<name> = {dark,light}` from the `base` group only, skipping any leaf
 * that does not resolve to a hex colour.
 */
function buildColorSurface(theme: ParsedCollection, registry: Registry): Record<string, ThemedColor> {
  const paths = [...leavesForMode(theme, "light").keys()].filter((p) => p.startsWith("base."));
  // `base.sidebar-accent` -> `sidebar-accent`; `base.chart-1` -> `chart-1`.
  const entries = paths.map((path) => ({ path, name: kebab(path.split(".").slice(1)) }));
  return resolveThemedPairs(theme, registry, entries).pairs;
}

/**
 * The `custom` group beside `base`: values a component needs that differ per
 * mode in a way no single `base` role expresses — a fill that is transparent in
 * light and a faint white wash in dark, say. Their Figma names spell out that
 * behaviour (`transparent dark:input\30`), which makes them unusable as CSS
 * variable names, so `build.ts` maps the ones we consume onto semantic names of
 * our own. Kept keyed by the raw Figma name here so that mapping is explicit.
 */
function buildCustomSurface(theme: ParsedCollection, registry: Registry): Record<string, ThemedColor> {
  const paths = [...leavesForMode(theme, "light").keys()].filter((p) => p.startsWith("custom."));
  const entries = paths.map((path) => ({ path, name: path.slice("custom.".length) }));
  return resolveThemedPairs(theme, registry, entries).pairs;
}

/**
 * Project a non-semantic Light/Dark collection (`Syntax`, `Gradient Colors`)
 * into `themed.<group>`, where `<group>` is the leaves' shared first segment:
 * `syntax.key` -> `themed.syntax.key`, `gradient.red.start` ->
 * `themed.gradient.red-start`. Namespacing by group is what stops two
 * Light/Dark collections landing on the same key.
 */
function buildThemedGroups(
  c: ParsedCollection,
  registry: Registry,
): { groups: Record<string, Record<string, ThemedColor>>; skipped: string[] } {
  const byGroup = new Map<string, Array<{ path: string; name: string }>>();
  for (const path of leavesForMode(c, "light").keys()) {
    const parts = path.split(".");
    // A leaf sitting at the collection root has no group of its own; fall back
    // to the collection name so it still gets a namespace of its own.
    const group = parts.length > 1 ? kebab([parts[0]!]) : kebab([c.name]);
    const name = kebab(parts.length > 1 ? parts.slice(1) : parts);
    const bucket = byGroup.get(group);
    if (bucket) bucket.push({ path, name });
    else byGroup.set(group, [{ path, name }]);
  }

  const groups: Record<string, Record<string, ThemedColor>> = {};
  const skipped: string[] = [];
  for (const [group, entries] of byGroup) {
    const resolved = resolveThemedPairs(c, registry, entries);
    skipped.push(...resolved.skipped);
    if (Object.keys(resolved.pairs).length > 0) groups[group] = resolved.pairs;
  }
  return { groups, skipped };
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

/**
 * Project a flat, one-level group without camel-casing its keys.
 *
 * `setNested` camel-cases each segment, which is right for `offset-x` ->
 * `offsetX` but destroys a numeric ramp: Tailwind's `1-5` (6px) would land as
 * `15`, indistinguishable from a real `15` step and neighbouring a `16` step
 * worth 4rem. Step names are data here, not identifiers.
 */
function buildFlatGroup(group: string, source: Map<string, Raw>, registry: Registry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const prefix = `${group}.`;
  for (const path of source.keys()) {
    if (!path.startsWith(prefix)) continue;
    out[path.slice(prefix.length)] = registry.resolve(path, NO_MODE);
  }
  return out;
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
    /**
     * Exports `src/collections.ts` does not classify. Defaulted to
     * `registry-only` so the sync still produces a reviewable PR; the resolver
     * spec fails until they are classified. Must be empty on a merged sync.
     */
    unclassifiedCollections: string[];
    /** Manifest entries with no matching export — renamed or removed in Figma. */
    staleCollectionRoles: string[];
  };
  color: Record<string, ThemedColor>;
  /** The `custom` group, keyed by its raw Figma name. See `buildCustomSurface`. */
  custom: Record<string, ThemedColor>;
  radius: Record<string, unknown>;
  /**
   * Figma's `shadow/*` scale. Steps are either a single layer (`xs`) or a
   * numbered stack of them (`sm.1`, `sm.2`); `build.ts` composes both shapes
   * into one `box-shadow` value.
   */
  shadow: Record<string, unknown>;
  /** Tailwind's 4px layout ramp (`0-5` = 2px … `20` = 80px) — what the frames lay out on. */
  spacing: Record<string, unknown>;
  text: Record<string, unknown>;
  fontFamily: Record<string, unknown>;
  fontWeight: Record<string, unknown>;
  /** Figma's `container/*` max-width scale (px). `build.ts` maps semantic roles onto these steps. */
  container: Record<string, unknown>;
  /**
   * Light/Dark collections other than the semantic surface, namespaced by
   * group: `themed.syntax.key`, `themed.gradient.red-start`. `build.ts` emits
   * these as `--zl-<group>-<name>` with a `[data-theme="light"]` override.
   */
  themed: Record<string, Record<string, ThemedColor>>;
  typography: Record<string, Record<string, unknown>>;
}

/**
 * Pure core of the sync: takes the raw parsed contents of every export file and
 * returns the resolved token surface. Kept separate from `main()` so it can be
 * unit-tested against the checked-in fixture without touching the filesystem.
 */
export function syncTokens(
  files: Array<{ name: string; data: unknown }>,
  roles: Record<string, CollectionRole> = collectionRoles,
): SyncedTokens {
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

  const { assigned, unclassified, stale } = assignRoles(collections, roles);

  const semantic = semanticCollection(assigned);
  const color = buildColorSurface(semantic, registry);
  const custom = buildCustomSurface(semantic, registry);
  if (Object.keys(color).length === 0) {
    throw new Error(`Semantic collection ${semantic.name} (${semantic.file}) produced no colours`);
  }

  // Each themed collection gets its own namespace. Roles keep them out of the
  // viewport bucket; `claim` keeps two of them off the same group name.
  const themed: Record<string, Record<string, ThemedColor>> = {};
  const themedOwners = new Map<string, string>();
  for (const c of withRole(assigned, "themed")) {
    const { groups, skipped } = buildThemedGroups(c, registry);
    if (Object.keys(groups).length === 0) {
      throw new Error(
        `Themed collection ${c.name} (${c.file}) produced no colours` +
          (skipped.length > 0 ? `; no leaf resolved to a hex in both modes (${skipped.join(", ")})` : ""),
      );
    }
    for (const [group, entries] of Object.entries(groups)) {
      claim(themed, themedOwners, group, `themed.${group}`, c.name, entries);
    }
  }

  // Primitive groups (radius/text/font/…) are merged across the collections
  // declared to own them, so they surface regardless of which file they sit in.
  // `Registry.add` has already rejected genuinely conflicting concrete values.
  const singleMode = new Map<string, Raw>();
  for (const c of withRole(assigned, "primitives")) {
    const flat = c.leaves.get(NO_MODE);
    if (flat) for (const [path, value] of flat) singleMode.set(path, value);
  }

  // The layout scale is Tailwind's, and it lives in the Tailwind collection —
  // which stays `registry-only` because its colour ramps are alias fodder, not
  // tokens we publish. Pull out this one group by name rather than promoting the
  // whole collection: it also declares `breakpoint`, which `2--theme` owns, and
  // merging the two would make one silently win.
  const spacingSource = new Map<string, Raw>();
  for (const [c] of assigned) {
    if (c.name !== SPACING_COLLECTION) continue;
    const flat = c.leaves.get(NO_MODE);
    if (flat) for (const [path, value] of flat) spacingSource.set(path, value);
  }
  const typography: Record<string, Record<string, unknown>> = {};
  const typographyOwners = new Map<string, string>();
  for (const c of withRole(assigned, "viewport")) {
    for (const mode of c.modes) {
      const modeOut: Record<string, unknown> = {};
      for (const path of leavesForMode(c, mode.toLowerCase()).keys()) {
        setNested(modeOut, path, registry.resolve(path, mode));
      }
      const key = mode.toLowerCase();
      claim(typography, typographyOwners, key, `typography.${key}`, c.name, modeOut);
    }
  }

  return {
    $source: {
      libraryName: "Zitadel - Design System - External",
      generatedBy: "scripts/sync-from-export.ts",
      collections: collections.map((c) => c.name),
      themeModes: ["dark", "light"],
      resolvedLeaves,
      unclassifiedCollections: unclassified,
      staleCollectionRoles: stale,
    },
    color,
    custom,
    radius: buildGroup("radius", singleMode, registry),
    shadow: buildGroup("shadow", singleMode, registry),
    spacing: buildFlatGroup("spacing", spacingSource, registry),
    text: buildGroup("text", singleMode, registry),
    fontFamily: buildGroup("font", singleMode, registry),
    fontWeight: buildGroup("font-weight", singleMode, registry),
    container: buildGroup("container", singleMode, registry),
    themed,
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
  const themedGroups = Object.entries(out.themed).map(([g, e]) => `${g} (${Object.keys(e).length})`);
  // eslint-disable-next-line no-console
  console.log(
    `design-tokens sync-export: resolved ${out.$source.resolvedLeaves} leaves across ${out.$source.collections.length} collections; ` +
      `surfaced ${Object.keys(out.color).length} colours` +
      (themedGroups.length > 0 ? ` + themed groups ${themedGroups.join(", ")}` : "") +
      ` -> ${TOKENS_FILE}`,
  );
  const { unclassifiedCollections, staleCollectionRoles } = out.$source;
  if (unclassifiedCollections.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `WARNING: ${unclassifiedCollections.join(", ")} not classified in src/collections.ts — ` +
        `defaulted to registry-only, so they surface nothing. design-tokens:test will fail until classified.`,
    );
  }
  if (staleCollectionRoles.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `WARNING: src/collections.ts classifies ${staleCollectionRoles.join(", ")}, but no export declares them. ` +
        `Renamed or removed in Figma?`,
    );
  }
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

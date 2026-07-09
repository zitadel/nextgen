/**
 * Offline token sync from designer DTCG JSON exports under `figma-export/`.
 *
 *   moon run design-tokens:sync-export
 *
 * The Figma Community sync plugin pushes W3C DTCG JSON to
 * `packages/design-tokens/figma-export/` on branch `design-tokens/figma-sync`.
 *
 * Supported export files (examples from the designer plugin):
 *   - `primitives.json` — neutral/accent/status ramps, radius, space
 *   - `semantic---light-dark.json` — semantic colours with Light/Dark modes
 *   - `layout.json` — grid/layout per breakpoint (2xl, lg, sm, xs)
 */
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = resolve(ROOT, "../figma-export");
const TOKENS_FILE = resolve(ROOT, "../src/generated/figma.tokens.json");

const PRESERVE_LEGACY = new Set(["status/positive"]);
const EXPORT_ORDER = ["primitives.json", "semantic---light-dark.json", "layout.json"];

type Hex = string;
type SemanticValue = Hex | { primitive: string };
type ModeValue = { dark: SemanticValue; light?: SemanticValue };
type ColorToken = SemanticValue | ModeValue;

interface DtcgLeaf {
  $type?: string;
  $value: string | number | { hex: string };
}

interface TokensFile {
  $source: Record<string, unknown>;
  primitives: {
    color: Record<string, Record<string, Hex> | Hex>;
    spacing: Record<string, number>;
    cornerRadius: Record<string, number>;
  };
  layout?: Record<string, Record<string, number>>;
  tokens: { color: Record<string, Record<string, ColorToken>> };
}

function isLeaf(node: unknown): node is DtcgLeaf {
  return typeof node === "object" && node !== null && "$value" in node;
}

function leafRaw(leaf: DtcgLeaf): string | number {
  const value = leaf.$value;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "hex" in value) {
    return value.hex.toLowerCase();
  }
  throw new Error(`Unsupported $value: ${JSON.stringify(value)}`);
}

function unwrapDtcg(node: unknown): unknown {
  if (isLeaf(node)) return leafRaw(node);
  if (typeof node !== "object" || node === null) return node;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    out[key] = unwrapDtcg(child);
  }
  return out;
}

const RADIUS_KEYS: Record<string, string> = {
  sm: "s",
  md: "m",
  lg: "l",
  xl: "xl",
  full: "full",
};

const SPACE_KEYS: Record<string, string> = {
  "1": "01",
  "2": "02",
  "3": "03",
  "4": "04",
  "6": "06",
  "8": "08",
  "12": "12",
};

function asHex(value: unknown, path: string): Hex {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) {
    throw new Error(`Expected hex colour at ${path}, got ${JSON.stringify(value)}`);
  }
  return value.toLowerCase();
}

function asNumber(value: unknown, path: string): number {
  if (typeof value !== "number") {
    throw new Error(`Expected number at ${path}, got ${JSON.stringify(value)}`);
  }
  return value;
}

/** `surface/base` -> surface + base; `action/primary/fill` -> action + primary-fill */
function groupAndName(slashPath: string): [group: string, name: string] {
  const [group, ...rest] = slashPath.split("/");
  return [group ?? "", rest.join("-")];
}

type AliasMap = Map<string, Hex>;

function buildPrimitiveAliases(data: Record<string, Record<string, unknown>>): AliasMap {
  const aliases: AliasMap = new Map();
  for (const [step, value] of Object.entries(data.neutral ?? {})) {
    aliases.set(`neutral.${step}`, asHex(value, `neutral/${step}`));
  }
  for (const [key, value] of Object.entries(data.accent ?? {})) {
    aliases.set(`accent.${key}`, asHex(value, `accent/${key}`));
  }
  for (const [key, value] of Object.entries(data.status ?? {})) {
    aliases.set(`status.${key}`, asHex(value, `status/${key}`));
  }
  return aliases;
}

function dotToSlash(ref: string): string {
  return ref.replace(/\./g, "/");
}

function resolveColorRef(
  raw: unknown,
  path: string,
  primitiveAliases: AliasMap,
  modeResolved: Map<string, Hex>,
): Hex {
  if (typeof raw !== "string") {
    throw new Error(`Expected colour reference at ${path}, got ${JSON.stringify(raw)}`);
  }
  if (raw.startsWith("#")) return asHex(raw, path);
  if (!raw.startsWith("{")) {
    throw new Error(`Expected alias or hex at ${path}, got ${JSON.stringify(raw)}`);
  }
  const ref = raw.slice(1, -1);
  if (primitiveAliases.has(ref)) return primitiveAliases.get(ref)!;
  const slash = dotToSlash(ref);
  if (modeResolved.has(slash)) return modeResolved.get(slash)!;
  throw new Error(`Unresolved alias ${raw} at ${path}`);
}

function flattenModeLeaves(
  node: unknown,
  prefix: string[] = [],
): Map<string, string | number> {
  const out = new Map<string, string | number>();
  if (isLeaf(node)) {
    out.set(prefix.join("/"), leafRaw(node));
    return out;
  }
  if (typeof node !== "object" || node === null) return out;
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("$")) continue;
    for (const [path, value] of flattenModeLeaves(child, [...prefix, key])) {
      out.set(path, value);
    }
  }
  return out;
}

function resolveModeColours(
  leaves: Map<string, string | number>,
  primitiveAliases: AliasMap,
): Map<string, Hex> {
  const resolved = new Map<string, Hex>();
  const pending = [...leaves.entries()];

  for (let pass = 0; pass < pending.length + 1 && pending.length > 0; pass += 1) {
    const next: typeof pending = [];
    for (const [path, raw] of pending) {
      try {
        resolved.set(path, resolveColorRef(raw, path, primitiveAliases, resolved));
      } catch {
        next.push([path, raw]);
      }
    }
    if (next.length === pending.length) {
      const [path, raw] = next[0]!;
      throw new Error(`Unresolved alias ${JSON.stringify(raw)} at ${path}`);
    }
    pending.length = 0;
    pending.push(...next);
  }
  return resolved;
}

function applyStatusModes(
  target: Record<string, ColorToken>,
  status: Record<string, unknown>,
): number {
  const pairs = new Map<string, { light?: Hex; dark?: Hex }>();
  for (const [key, raw] of Object.entries(status)) {
    const hex = asHex(raw, `status/${key}`);
    const lightMatch = key.match(/^(.+)-light$/);
    const darkMatch = key.match(/^(.+)-dark$/);
    if (lightMatch) {
      const base = lightMatch[1]!;
      const entry = pairs.get(base) ?? {};
      entry.light = hex;
      pairs.set(base, entry);
    } else if (darkMatch) {
      const base = darkMatch[1]!;
      const entry = pairs.get(base) ?? {};
      entry.dark = hex;
      pairs.set(base, entry);
    }
  }

  let applied = 0;
  for (const [name, { light, dark }] of pairs) {
    const slashPath = `status/${name}`;
    if (PRESERVE_LEGACY.has(slashPath) || !dark) continue;
    target[name] = light && light !== dark ? { dark, light } : dark;
    applied += 1;
  }
  return applied;
}

function applyPrimitivesExport(
  file: TokensFile,
  raw: unknown,
  primitiveAliases: AliasMap,
): number {
  const data = unwrapDtcg(raw) as Record<string, Record<string, unknown>>;
  for (const [key, hex] of buildPrimitiveAliases(data)) primitiveAliases.set(key, hex);

  let applied = 0;

  if (data.neutral) {
    file.primitives.color.neutral = {};
    for (const [step, value] of Object.entries(data.neutral)) {
      file.primitives.color.neutral[step] = asHex(value, `neutral/${step}`);
      applied += 1;
    }
  }

  if (data.accent) {
    file.primitives.color.purple ??= {};
    file.tokens.color.accent ??= {};
    for (const [key, value] of Object.entries(data.accent)) {
      if (/^\d+$/.test(key)) {
        (file.primitives.color.purple as Record<string, Hex>)[key] = asHex(
          value,
          `accent/${key}`,
        );
        applied += 1;
        continue;
      }
      if (key === "subtle-dark" || key === "subtle-light") {
        file.tokens.color.accent[key] = asHex(value, `accent/${key}`);
        applied += 1;
      }
    }
  }

  if (data.status) {
    file.tokens.color.status ??= {};
    applied += applyStatusModes(file.tokens.color.status, data.status);
  }

  if (data.radius) {
    for (const [key, value] of Object.entries(data.radius)) {
      const mapped = RADIUS_KEYS[key] ?? key;
      file.primitives.cornerRadius[mapped] = asNumber(value, `radius/${key}`);
      applied += 1;
    }
  }

  if (data.space) {
    for (const [key, value] of Object.entries(data.space)) {
      const mapped = SPACE_KEYS[key] ?? key.padStart(2, "0");
      file.primitives.spacing[mapped] = asNumber(value, `space/${key}`);
      applied += 1;
    }
  }

  return applied;
}

function applySemanticExport(
  file: TokensFile,
  raw: unknown,
  primitiveAliases: AliasMap,
): number {
  const root = raw as Record<string, unknown>;
  const lightLeaves = flattenModeLeaves(root.Light);
  const darkLeaves = flattenModeLeaves(root.Dark);
  const light = resolveModeColours(lightLeaves, primitiveAliases);
  const dark = resolveModeColours(darkLeaves, primitiveAliases);

  let applied = 0;
  for (const [slashPath, darkHex] of dark) {
    if (PRESERVE_LEGACY.has(slashPath)) continue;
    const [group, name] = groupAndName(slashPath);
    if (!group || !name) continue;
    const lightHex = light.get(slashPath);
    const token: ColorToken =
      lightHex && lightHex !== darkHex ? { dark: darkHex, light: lightHex } : darkHex;
    (file.tokens.color[group] ??= {})[name] = token;
    applied += 1;
  }
  return applied;
}

function applyLayoutExport(file: TokensFile, raw: unknown): number {
  const root = raw as Record<string, unknown>;
  const metadata = root.$metadata as { modes?: string[] } | undefined;
  const modes = metadata?.modes ?? Object.keys(root).filter((key) => !key.startsWith("$"));
  file.layout ??= {};

  let applied = 0;
  for (const mode of modes) {
    const layout = (unwrapDtcg(root[mode]) as { layout?: Record<string, unknown> }).layout;
    if (!layout) continue;
    file.layout[mode.toLowerCase()] = {};
    for (const [key, value] of Object.entries(layout)) {
      file.layout[mode.toLowerCase()]![key] = asNumber(value, `layout/${mode}/${key}`);
      applied += 1;
    }
  }
  return applied;
}

function exportKind(name: string, raw: unknown): "primitives" | "semantic" | "layout" | "unknown" {
  if (name === "primitives.json") return "primitives";
  if (name === "layout.json") return "layout";
  if (name.includes("semantic") && typeof raw === "object" && raw !== null && "Light" in raw) {
    return "semantic";
  }
  return "unknown";
}

async function main(): Promise<void> {
  try {
    await access(EXPORT_DIR);
  } catch {
    throw new Error(
      `Export directory not found: ${EXPORT_DIR}. Configure the Figma plugin to push DTCG JSON to packages/design-tokens/figma-export on branch design-tokens/figma-sync.`,
    );
  }

  const entries = await readdir(EXPORT_DIR);
  const jsonFiles = entries
    .filter((name) => name.endsWith(".json"))
    .sort(
      (a, b) =>
        (EXPORT_ORDER.indexOf(a) === -1 ? 99 : EXPORT_ORDER.indexOf(a)) -
        (EXPORT_ORDER.indexOf(b) === -1 ? 99 : EXPORT_ORDER.indexOf(b)),
    );
  if (jsonFiles.length === 0) {
    throw new Error(`No JSON exports found in ${EXPORT_DIR}`);
  }

  const tokensRaw = await readFile(TOKENS_FILE, "utf8");
  const file = JSON.parse(tokensRaw) as TokensFile;
  const primitiveAliases: AliasMap = new Map();

  let applied = 0;
  for (const name of jsonFiles) {
    const raw = JSON.parse(await readFile(resolve(EXPORT_DIR, name), "utf8"));
    switch (exportKind(name, raw)) {
      case "primitives":
        applied += applyPrimitivesExport(file, raw, primitiveAliases);
        break;
      case "semantic":
        applied += applySemanticExport(file, raw, primitiveAliases);
        break;
      case "layout":
        applied += applyLayoutExport(file, raw);
        break;
      default:
        // eslint-disable-next-line no-console
        console.warn(`design-tokens sync-export: skipping unhandled export ${name}`);
    }
  }

  file.$source = {
    ...file.$source,
    fetchedVia: `Generated by scripts/sync-from-export.ts from figma-export/{${jsonFiles.join(",")}}`,
  };

  await writeFile(TOKENS_FILE, `${JSON.stringify(file, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`design-tokens sync-export: applied ${applied} values to ${TOKENS_FILE}`);
  // eslint-disable-next-line no-console
  console.warn("Now run `moon run design-tokens:generate` and review the tokens.snapshot.spec.ts diff.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

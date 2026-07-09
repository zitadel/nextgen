/**
 * Offline token sync from designer DTCG JSON exports under `tokens/`.
 *
 *   moon run design-tokens:sync-export
 *
 * The Figma Community sync plugin pushes W3C DTCG JSON to repo `nextgen`, branch
 * `design-tokens/figma-sync`, path `tokens/` (e.g. `tokens/primitives.json`).
 * This script merges those exports into `src/generated/figma.tokens.json` and
 * leaves everything else (legacy login tokens, unexported keys) untouched.
 *
 * Supported exports today:
 *   - `primitives.json` — neutral/accent/status ramps, radius, space
 *
 * After running, execute `moon run design-tokens:generate` and review the
 * snapshot diff.
 */
import { access, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = resolve(ROOT, "../../../tokens");
const TOKENS_FILE = resolve(ROOT, "../src/generated/figma.tokens.json");

/** Canonical paths that stay on the legacy value (login shares them). */
const PRESERVE_LEGACY = new Set(["status/positive"]);

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
  layout?: unknown;
  tokens: { color: Record<string, Record<string, ColorToken>> };
}

function isLeaf(node: unknown): node is DtcgLeaf {
  return typeof node === "object" && node !== null && "$value" in node;
}

function leafValue(leaf: DtcgLeaf): string | number {
  const value = leaf.$value;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "object" && value !== null && "hex" in value) {
    return value.hex.toLowerCase();
  }
  throw new Error(`Unsupported $value: ${JSON.stringify(value)}`);
}

/** Strip DTCG wrappers into plain nested objects (`neutral/100` -> `#ededed`). */
function unwrapDtcg(node: unknown): unknown {
  if (isLeaf(node)) return leafValue(node);
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
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
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
    target[name] =
      light && light !== dark ? { dark, light } : dark;
    applied += 1;
  }
  return applied;
}

function applyPrimitivesExport(file: TokensFile, raw: unknown): number {
  const data = unwrapDtcg(raw) as Record<string, Record<string, unknown>>;
  let applied = 0;

  const neutral = data.neutral;
  if (neutral) {
    file.primitives.color.neutral = {};
    for (const [step, value] of Object.entries(neutral)) {
      file.primitives.color.neutral[step] = asHex(value, `neutral/${step}`);
      applied += 1;
    }
  }

  const accent = data.accent;
  if (accent) {
    file.primitives.color.purple ??= {};
    file.tokens.color.accent ??= {};
    for (const [key, value] of Object.entries(accent)) {
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

  const status = data.status;
  if (status) {
    file.tokens.color.status ??= {};
    applied += applyStatusModes(file.tokens.color.status, status);
  }

  const radius = data.radius;
  if (radius) {
    for (const [key, value] of Object.entries(radius)) {
      const mapped = RADIUS_KEYS[key] ?? key;
      file.primitives.cornerRadius[mapped] = asNumber(value, `radius/${key}`);
      applied += 1;
    }
  }

  const space = data.space;
  if (space) {
    for (const [key, value] of Object.entries(space)) {
      const mapped = SPACE_KEYS[key] ?? key.padStart(2, "0");
      file.primitives.spacing[mapped] = asNumber(value, `space/${key}`);
      applied += 1;
    }
  }

  return applied;
}

async function main(): Promise<void> {
  try {
    await access(EXPORT_DIR);
  } catch {
    throw new Error(
      `Export directory not found: ${EXPORT_DIR}. Configure the Figma plugin to push DTCG JSON to tokens/ on branch design-tokens/figma-sync.`,
    );
  }

  const entries = await readdir(EXPORT_DIR);
  const jsonFiles = entries.filter((name) => name.endsWith(".json")).sort();
  if (jsonFiles.length === 0) {
    throw new Error(`No JSON exports found in ${EXPORT_DIR}`);
  }

  const tokensRaw = await readFile(TOKENS_FILE, "utf8");
  const file = JSON.parse(tokensRaw) as TokensFile;

  let applied = 0;
  for (const name of jsonFiles) {
    const raw = JSON.parse(await readFile(resolve(EXPORT_DIR, name), "utf8"));
    if (name === "primitives.json") {
      applied += applyPrimitivesExport(file, raw);
      continue;
    }
    // eslint-disable-next-line no-console
    console.warn(`design-tokens sync-export: skipping unhandled export ${name}`);
  }

  file.$source = {
    ...file.$source,
    fetchedVia: `Generated by scripts/sync-from-export.ts from tokens/{${jsonFiles.join(",")}}`,
    syncedAt: new Date().toISOString().slice(0, 10),
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

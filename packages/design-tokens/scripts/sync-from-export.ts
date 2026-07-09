/**
 * Offline token sync from a DTCG variable export.
 *
 *   moon run design-tokens:sync-export
 *
 * The canonical Zitadel Design System variables are exported from Figma via a
 * Plugin-API exporter (works on any plan — no Enterprise Variables REST) as
 * W3C DTCG JSON, committed under `figma-export/`. This script reads the
 * `Semantic — Light_Dark` collection (both modes) and regenerates the
 * canonical semantic colour groups in `src/generated/figma.tokens.json`.
 *
 * A Figma Community sync plugin writes W3C DTCG JSON under `figma-export/`.
 * This script is the deterministic bridge from that export
 * to `figma.tokens.json`.
 *
 * What it touches:
 *   - Overwrites the canonical semantic colour groups (surface/text/border/
 *     accent/status/focus/state/scrim/icon/action) with the export's per-mode
 *     values, emitting `{ dark, light }` (or a single string when equal).
 *   - Preserves everything else verbatim: primitives, spacing, cornerRadius,
 *     layout, and the legacy login tokens (`surface/default-*`, `text/*-white`,
 *     `*-success`, `subtitle-*`, …) that packages/components still consumes.
 *   - PRESERVES the legacy `status/positive` (#33a779) that login's success
 *     styling binds; the canonical positive is intentionally NOT applied until
 *     login migrates. See PRESERVE_LEGACY below.
 *
 * After running, execute `moon run design-tokens:generate` and review the
 * `tokens.snapshot.spec.ts` diff — new canonical keys are an intentional,
 * reviewed addition.
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const EXPORT_DIR = resolve(ROOT, "../figma-export/Semantic — Light_Dark");
const TOKENS_FILE = resolve(ROOT, "../src/generated/figma.tokens.json");

/** Canonical group/name paths that stay on the legacy value (login shares them). */
const PRESERVE_LEGACY = new Set(["status/positive"]);

type Hex = string;
type SemanticValue = Hex | { primitive: string };
type ModeValue = { dark: SemanticValue; light?: SemanticValue };
type ColorToken = SemanticValue | ModeValue;

interface DtcgLeaf {
  $type?: string;
  $value: { hex: string } | string;
}
type DtcgNode = DtcgLeaf | { [key: string]: DtcgNode };

interface TokensFile {
  $source: Record<string, unknown>;
  primitives: unknown;
  layout?: unknown;
  tokens: { color: Record<string, Record<string, ColorToken>> };
}

function isLeaf(node: DtcgNode): node is DtcgLeaf {
  return typeof node === "object" && node !== null && "$value" in node;
}

/** Flatten one DTCG mode file into `{ "group/name": "#rrggbb" }`, resolving `{ref}` aliases. */
function flatten(root: Record<string, DtcgNode>): Map<string, Hex> {
  const out = new Map<string, Hex>();

  const walk = (node: DtcgNode, path: string[]): void => {
    if (isLeaf(node)) {
      out.set(path.join("/"), leafHex(node, root, path));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith("$")) continue;
      walk(child, [...path, key]);
    }
  };
  for (const [key, child] of Object.entries(root)) {
    if (key.startsWith("$")) continue;
    walk(child, [key]);
  }
  return out;
}

function leafHex(leaf: DtcgLeaf, root: Record<string, DtcgNode>, path: string[]): Hex {
  const value = leaf.$value;
  if (typeof value === "object" && value !== null && "hex" in value) {
    return value.hex.toLowerCase();
  }
  if (typeof value === "string") {
    const ref = value.replace(/^\{|\}$/g, ""); // "{text.primary}" -> "text.primary"
    const target = getByDotPath(root, ref.split("."));
    if (!target || !isLeaf(target)) {
      throw new Error(`Alias ${value} at ${path.join("/")} did not resolve to a leaf`);
    }
    return leafHex(target, root, ref.split("."));
  }
  throw new Error(`Unsupported $value at ${path.join("/")}: ${JSON.stringify(value)}`);
}

function getByDotPath(root: Record<string, DtcgNode>, parts: string[]): DtcgNode | undefined {
  let cursor: DtcgNode | undefined = root as unknown as DtcgNode;
  for (const part of parts) {
    if (!cursor || isLeaf(cursor)) return undefined;
    cursor = (cursor as Record<string, DtcgNode>)[part];
  }
  return cursor;
}

/** `surface/base` -> ["surface","base"]; `action/primary/fill` -> ["action","primary-fill"]. */
function groupAndName(slashPath: string): [group: string, name: string] {
  const [group, ...rest] = slashPath.split("/");
  return [group ?? "", rest.join("-")];
}

async function main(): Promise<void> {
  const [darkRaw, lightRaw, tokensRaw] = await Promise.all([
    readFile(resolve(EXPORT_DIR, "Dark.tokens.json"), "utf8"),
    readFile(resolve(EXPORT_DIR, "Light.tokens.json"), "utf8"),
    readFile(TOKENS_FILE, "utf8"),
  ]);

  const dark = flatten(JSON.parse(darkRaw));
  const light = flatten(JSON.parse(lightRaw));
  const file = JSON.parse(tokensRaw) as TokensFile;

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

  file.$source = {
    ...file.$source,
    fetchedVia:
      "Generated by scripts/sync-from-export.ts from the DTCG variable export in figma-export/ (Semantic — Light_Dark, both modes). Legacy default-*/success/subtitle-* login tokens and status/positive are preserved verbatim.",
    syncedAt: new Date().toISOString().slice(0, 10),
  };

  await writeFile(TOKENS_FILE, `${JSON.stringify(file, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`design-tokens sync-export: applied ${applied} canonical tokens to ${TOKENS_FILE}`);
  // eslint-disable-next-line no-console
  console.warn("Now run `moon run design-tokens:generate` and review the tokens.snapshot.spec.ts diff.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

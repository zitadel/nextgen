/**
 * Pulls the published Variables of the Zitadel Design System library from
 * Figma's REST API and writes them to `src/generated/figma.tokens.json`.
 *
 *   moon run design-tokens:sync
 *
 * Requires `FIGMA_TOKEN` (a personal access token with read access to the
 * design system file). The file key, library name and pinned published
 * version are read from `figma-tokens.lock` — bumping the lock file is the
 * single, explicit, PR-gated way to ingest new design system content.
 *
 * The script never mutates any other file. After it writes the JSON, the
 * caller runs `:generate` to rebuild the CSS / TS / Tailwind surfaces, and
 * the snapshot test in `src/tokens.snapshot.spec.ts` fails CI if any
 * public token name was added, removed, or renamed.
 *
 * The Figma REST endpoints used:
 *   GET /v1/files/:file_key/variables/published
 *   GET /v1/files/:file_key/variables/local      (fallback if the file is
 *                                                 unpublished or the
 *                                                 published API errors)
 *
 * Reference: https://www.figma.com/developers/api#variables
 */
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface FigmaTokensLock {
  fileKey: string;
  libraryName: string;
  libraryKey: string;
  version: string;
  pulledAt: string | null;
  pulledBy: string | null;
}

interface FigmaVariablesResponse {
  status: number;
  error: boolean;
  meta?: {
    variables: Record<string, FigmaVariable>;
    variableCollections: Record<string, FigmaVariableCollection>;
  };
}

interface FigmaVariable {
  id: string;
  name: string;
  resolvedType: "COLOR" | "FLOAT" | "STRING" | "BOOLEAN";
  variableCollectionId: string;
  valuesByMode: Record<string, FigmaVariableValue>;
}

type FigmaVariableValue =
  | { type: "VARIABLE_ALIAS"; id: string }
  | { r: number; g: number; b: number; a: number }
  | number
  | string
  | boolean;

interface FigmaVariableCollection {
  id: string;
  name: string;
  modes: Array<{ modeId: string; name: string }>;
  defaultModeId: string;
}

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(ROOT, "../src/generated/figma.tokens.json");
// Read rather than import: the lock is JSON but not `.json`, and an import
// attribute cannot describe an extension Node has no loader for.
const lock = JSON.parse(
  readFileSync(resolve(ROOT, "../figma-tokens.lock"), "utf8"),
) as FigmaTokensLock;

async function main(): Promise<void> {
  const token = process.env["FIGMA_TOKEN"];
  if (!token) {
    throw new Error("FIGMA_TOKEN env var is required. Generate at https://www.figma.com/developers/api#access-tokens and add it to repo secrets for CI.");
  }
  const published = await fetchVariables(token, lock.fileKey, "published");
  const collections = indexCollections(published);
  const tokensFile = normalise(published, collections);
  await writeFile(OUT, `${JSON.stringify(tokensFile, null, 2)}\n`);
  // eslint-disable-next-line no-console
  console.log(`design-tokens sync: wrote ${OUT}`);
  // eslint-disable-next-line no-console
  console.warn(
    "Remember to bump figma-tokens.lock with the new published version and `pulledAt`/`pulledBy`, then run `moon run design-tokens:generate` and commit the result. CI sync workflow does this automatically; if you ran sync manually, do it now.",
  );
}

async function fetchVariables(token: string, fileKey: string, endpoint: "published" | "local"): Promise<FigmaVariablesResponse> {
  const url = `https://api.figma.com/v1/files/${fileKey}/variables/${endpoint}`;
  const res = await fetch(url, { headers: { "X-Figma-Token": token } });
  if (!res.ok) {
    throw new Error(`Figma REST returned ${res.status} for ${url}: ${await res.text()}`);
  }
  return (await res.json()) as FigmaVariablesResponse;
}

function indexCollections(response: FigmaVariablesResponse): Map<string, FigmaVariableCollection> {
  const map = new Map<string, FigmaVariableCollection>();
  for (const c of Object.values(response.meta?.variableCollections ?? {})) {
    map.set(c.id, c);
  }
  return map;
}

interface NormalisedTokensFile {
  $source: Record<string, unknown>;
  primitives: {
    color: Record<string, unknown>;
    spacing: Record<string, number>;
    cornerRadius: Record<string, number>;
  };
  tokens: {
    color: Record<string, Record<string, string | { primitive: string }>>;
  };
}

/**
 * Normalises the Figma REST response into the same shape the build script
 * (and the seed `figma.tokens.json`) already understand.
 *
 * Figma names variables with slashes (`color/border/error`,
 * `spacing/spacing-03`, `corner radius/s`). We split on `/`, lowercase
 * and trim, then route into `primitives.*` or `tokens.*` based on the
 * collection the variable belongs to (`Primitives` vs `Tokens`).
 */
function normalise(response: FigmaVariablesResponse, collections: Map<string, FigmaVariableCollection>): NormalisedTokensFile {
  const out: NormalisedTokensFile = {
    $source: {
      fileKey: lock.fileKey,
      libraryName: lock.libraryName,
      fetchedVia: `Figma REST GET /v1/files/${lock.fileKey}/variables/published`,
      modeId: "default",
      modeName: "Default (dark)",
    },
    primitives: { color: {}, spacing: {}, cornerRadius: {} },
    tokens: { color: {} },
  };

  for (const variable of Object.values(response.meta?.variables ?? {})) {
    const collection = collections.get(variable.variableCollectionId);
    if (!collection) continue;
    const value = variable.valuesByMode[collection.defaultModeId];
    if (value === undefined) continue;
    insertVariable(out, collection.name, variable, value, response);
  }
  return out;
}

function insertVariable(
  out: NormalisedTokensFile,
  collectionName: string,
  variable: FigmaVariable,
  value: FigmaVariableValue,
  response: FigmaVariablesResponse,
): void {
  const path = variable.name.split("/").map((seg) => seg.trim().toLowerCase().replaceAll(" ", "-"));
  if (collectionName === "Primitives") {
    insertPrimitive(out.primitives, variable.resolvedType, path, value);
    return;
  }
  if (collectionName === "Tokens") {
    insertSemantic(out.tokens, path, value, response);
  }
}

function insertPrimitive(
  primitives: NormalisedTokensFile["primitives"],
  type: FigmaVariable["resolvedType"],
  path: string[],
  value: FigmaVariableValue,
): void {
  const [category, ...rest] = path;
  if (type === "COLOR" && category === "color") {
    setNested(primitives.color, rest, rgbaToHex(value as { r: number; g: number; b: number; a: number }));
    return;
  }
  if (type === "FLOAT" && category === "spacing") {
    primitives.spacing[rest.join("-")] = value as number;
    return;
  }
  if (type === "FLOAT" && (category === "corner-radius" || category === "corner")) {
    primitives.cornerRadius[rest.join("-")] = value as number;
  }
}

function insertSemantic(
  tokens: NormalisedTokensFile["tokens"],
  path: string[],
  value: FigmaVariableValue,
  response: FigmaVariablesResponse,
): void {
  const [category, group, ...nameParts] = path;
  if (category !== "color") return;
  const groupKey = group ?? "uncategorised";
  const name = nameParts.join("-");
  if (!tokens.color[groupKey]) tokens.color[groupKey] = {};
  if (isAlias(value)) {
    const target = response.meta?.variables[value.id];
    if (!target) return;
    const targetPath = target.name.split("/").map((seg) => seg.trim().toLowerCase().replaceAll(" ", "-"));
    tokens.color[groupKey][name] = { primitive: pathToDotPath(targetPath) };
    return;
  }
  tokens.color[groupKey][name] = rgbaToHex(value as { r: number; g: number; b: number; a: number });
}

function isAlias(value: FigmaVariableValue): value is { type: "VARIABLE_ALIAS"; id: string } {
  return typeof value === "object" && value !== null && "type" in value && value.type === "VARIABLE_ALIAS";
}

function pathToDotPath(parts: string[]): string {
  const [category, ...rest] = parts;
  return [category, rest.join(".")].join(".");
}

function setNested(target: Record<string, unknown>, path: string[], value: string): void {
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

function rgbaToHex(rgba: { r: number; g: number; b: number; a: number }): string {
  const r = Math.round(rgba.r * 255).toString(16).padStart(2, "0");
  const g = Math.round(rgba.g * 255).toString(16).padStart(2, "0");
  const b = Math.round(rgba.b * 255).toString(16).padStart(2, "0");
  if (rgba.a < 1) {
    const a = Math.round(rgba.a * 255).toString(16).padStart(2, "0");
    return `#${r}${g}${b}${a}`;
  }
  return `#${r}${g}${b}`;
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

import { readFile } from "node:fs/promises";

import type { ZitadelClient } from "@zitadel/api/client";
import type { GetVariables200 } from "@zitadel/api/generated/model";

import { ZitadelError } from "./errors";

/**
 * A variable as the platform reports it. A non-secret carries its value; a
 * secret carries none, because a read answers `{"secret": true}` and never
 * discloses what is stored (ADR 062 §7).
 */
export type VariableRow = {
  name: string;
  secret: boolean;
  value?: string | number | boolean;
};

/**
 * Environment-name grammar from `environment-name.yaml`: a lowercase
 * DNS-style label. Checked before the request so a malformed name fails with
 * the CLI's own message instead of a 400 from the edge.
 */
const ENVIRONMENT_NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** Longest name the platform accepts, from the same schema. */
const ENVIRONMENT_NAME_MAX = 63;

/**
 * Resolve the `--environment` flag into the query parameter the variables
 * endpoints take. Omitted addresses the project level, which is an owner of
 * its own rather than a default the environments fall back to (ADR 062 §4).
 *
 * The name is validated but not resolved to an id here: the platform resolves
 * it at the edge and answers `var.not_found` for a name no environment
 * answers to, so a second round trip would only duplicate that check.
 */
export function environmentParam(environment?: string): { environment_name?: string } {
  if (environment === undefined) {
    return {};
  }
  if (!ENVIRONMENT_NAME.test(environment) || environment.length > ENVIRONMENT_NAME_MAX) {
    throw new ZitadelError(
      "E_VALIDATION",
      `Invalid environment name ${JSON.stringify(environment)}.`,
      {
        hint: "An environment name is a lowercase DNS-style label: letters, digits, and hyphens between them.",
      },
    );
  }
  return { environment_name: environment };
}

/** How an owner is named in output: an environment, or the project itself. */
export function ownerLabel(environment?: string): string {
  return environment ?? "the project";
}

/**
 * Project the wire map into rows. The platform keys the response by name,
 * with a bare scalar for a non-secret and `{secret: true}` for a secret; rows
 * are sorted by name so output is stable between runs.
 */
export function toVariableRows(body: GetVariables200): VariableRow[] {
  return Object.entries(body)
    .map(([name, value]) =>
      typeof value === "object" && value !== null
        ? { name, secret: true }
        : { name, secret: false, value },
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Render rows as the plain-text table, carrying the owner in its header the way
 * `schemas list` carries its objectType. Secrets print a marker rather than a
 * value: there is nothing to print, and a blank column would read as an empty
 * value rather than as a withheld one.
 */
export function renderVariableTable(
  rows: ReadonlyArray<VariableRow>,
  environment?: string,
): string {
  const owner = ownerLabel(environment);
  if (rows.length === 0) {
    return `No variables entered on ${owner}.`;
  }
  const header = `Variables on ${owner} (${rows.length})`;
  const nameCol = Math.max("name".length, ...rows.map((r) => r.name.length));
  const valueCol = Math.max(
    "value".length,
    ...rows.map((r) => (r.secret ? SECRET_MARKER.length : String(r.value).length)),
  );
  const body = rows.map(
    (r) => `${r.name.padEnd(nameCol)}  ${r.secret ? SECRET_MARKER : String(r.value)}`,
  );
  return [
    header,
    `${"name".padEnd(nameCol)}  ${"value".padEnd(valueCol)}`,
    `${"-".repeat(nameCol)}  ${"-".repeat(valueCol)}`,
    ...body,
  ].join("\n");
}

/** Stands in for a secret's value, which the platform never discloses. */
const SECRET_MARKER = "(secret)";

/**
 * Read a `.env`-style file into name/value pairs.
 *
 * Deliberately small: `KEY=VALUE` per line, `#` comments, blank lines skipped,
 * and one matching pair of surrounding quotes stripped. It does not expand
 * references or run shell syntax — a value here is written verbatim to the
 * platform, so interpreting it would change the credential that ends up
 * stored.
 */
export function parseEnvFile(contents: string): Record<string, string> {
  // Null-prototype: `__proto__` satisfies the platform's `^\w+$` name grammar,
  // and assigning it on an ordinary object would invoke the prototype setter
  // and drop the line while still reporting success.
  const values: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const raw of contents.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const name = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(".*"|'.*')$/s.test(value)) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

/**
 * Read and parse a `.env`-style file.
 *
 * A missing file is the common mistake and reports as `E_NOT_FOUND`; anything
 * else (a directory, a permission error) carries its own message so the cause
 * is not flattened into "not found".
 */
export async function readEnvFile(path: string): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(path, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new ZitadelError(
      code === "ENOENT" ? "E_NOT_FOUND" : "E_VALIDATION",
      `Cannot read ${path}${code === "ENOENT" ? "" : `: ${(error as Error).message}`}.`,
      { hint: "Pass --file with a path to a .env-style file." },
    );
  }
}

/**
 * Names the platform accepts, from `variable-name.yaml`: word characters only,
 * which is exactly what the `${{ NAME }}` reference syntax can address
 * (ADR 062 §2). Checked before the patch so one bad line in a `.env` file is
 * named locally rather than failing the whole transaction at the edge.
 */
const VARIABLE_NAME = /^\w+$/;

/** Longest name the same schema accepts. */
const VARIABLE_NAME_MAX = 255;

/** Reject a name the platform would refuse, naming it. */
export function assertVariableName(name: string): void {
  if (!VARIABLE_NAME.test(name)) {
    throw new ZitadelError("E_VALIDATION", `Invalid variable name ${JSON.stringify(name)}.`, {
      hint: "A variable name contains only letters, digits and underscores.",
    });
  }
  if (name.length > VARIABLE_NAME_MAX) {
    throw new ZitadelError(
      "E_VALIDATION",
      `Variable name is ${name.length} characters; the limit is ${VARIABLE_NAME_MAX}.`,
      { hint: "Shorten the name." },
    );
  }
}

/**
 * Fetch every variable entered at one owner, already projected into rows.
 * Keeps the owner-addressing rule in one place rather than in the command.
 */
export async function listVariables(
  client: ZitadelClient,
  projectId: string,
  environment?: string,
): Promise<VariableRow[]> {
  const body = await client.getVariables({
    project_id: projectId,
    ...environmentParam(environment),
  });
  return toVariableRows(body);
}

/**
 * Read a value from stdin, for the non-interactive path
 * (`variables set NAME --secret < secret.txt`).
 *
 * A single trailing newline is stripped — a here-doc or `echo` adds one and it
 * is not part of the credential — but nothing else is trimmed, because
 * whitespace inside a value is the caller's to decide.
 */
export async function readStdin(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

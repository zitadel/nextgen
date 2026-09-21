import type { GetVariable200, GetVariables200 } from "@zitadel/api/generated/model";

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
 * Project one wire value into a row. Both endpoints answer in the same two
 * forms — a bare scalar for a non-secret, `{"secret": true}` for a secret — so
 * the collection and the single-name read share this.
 */
export function toVariableRow(name: string, value: GetVariable200): VariableRow {
  return typeof value === "object" && value !== null
    ? { name, secret: true }
    : { name, secret: false, value };
}

/**
 * Project the wire map into rows, sorted by name so output is stable between
 * runs.
 */
export function toVariableRows(body: GetVariables200): VariableRow[] {
  return Object.entries(body)
    .map(([name, value]) => toVariableRow(name, value))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Stands in for a secret's value, which the platform never discloses. */
const SECRET_MARKER = "(secret)";

/**
 * Render a stored scalar for a terminal.
 *
 * A value is attacker-influenceable — anyone holding `variable.write` chooses
 * it — so it is never interpolated raw. A newline would break the table out of
 * its own row, and an ESC or OSC byte would drive the terminal itself (setting
 * its title, or writing the clipboard through OSC 52). Control and format
 * characters are therefore escaped to their `\xNN`/`\uNNNN` spelling, which
 * keeps ordinary values readable and leaves nothing executable behind.
 */
export function renderScalar(value: string | number | boolean | undefined): string {
  if (typeof value !== "string") {
    return String(value);
  }
  return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code <= 0xff
      ? `\\x${code.toString(16).padStart(2, "0")}`
      : `\\u${code.toString(16).padStart(4, "0")}`;
  });
}

/**
 * Render rows as the plain-text table, carrying the owner in its header the way
 * `schemas list` carries its objectType. Secrets print a marker rather than a
 * value: there is nothing to print, and a blank column would read as an empty
 * value rather than as a withheld one.
 */
export function renderVariableTable(rows: ReadonlyArray<VariableRow>, owner: string): string {
  if (rows.length === 0) {
    return `No variables entered on ${owner}.`;
  }
  const header = `Variables on ${owner} (${rows.length})`;
  const nameCol = Math.max("name".length, ...rows.map((r) => r.name.length));
  const valueCol = Math.max(
    "value".length,
    ...rows.map((r) => (r.secret ? SECRET_MARKER.length : renderScalar(r.value).length)),
  );
  const body = rows.map(
    (r) => `${r.name.padEnd(nameCol)}  ${r.secret ? SECRET_MARKER : renderScalar(r.value)}`,
  );
  return [
    header,
    `${"name".padEnd(nameCol)}  ${"value".padEnd(valueCol)}`,
    `${"-".repeat(nameCol)}  ${"-".repeat(valueCol)}`,
    ...body,
  ].join("\n");
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
 * Read a value from stdin, for the non-interactive path
 * (`variables set NAME --secret < secret.txt`).
 *
 * A single trailing newline is stripped — a here-doc or `echo` adds one and it
 * is not part of the credential — but nothing else is trimmed, because
 * whitespace inside a value is the caller's to decide.
 */
export async function readStdin(stream: NodeJS.ReadableStream): Promise<string> {
  // A local accumulator: `Array.fromAsync` would read better but is not on
  // every Node the package supports.
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks)
    .toString("utf8")
    .replace(/\r?\n$/, "");
}

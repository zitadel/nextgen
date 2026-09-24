import type { GetVariable200, GetVariables200 } from "@zitadel/api/generated/model";

import { escapeControlCharacters } from "./api-client";
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
 * it — so it is never interpolated raw. The client already escapes what could
 * drive the terminal; this also escapes a newline and a tab, which would
 * break the table out of its own row or split a tab-separated line.
 */
export function renderScalar(value: string | number | boolean | undefined): string {
  if (typeof value !== "string") {
    return String(value);
  }
  return escapeControlCharacters(value, { keepLayout: false });
}

/**
 * The rows as the cells the resource commands' renderers print, one per
 * column. Those renderers print a string verbatim, so every value is escaped
 * here first: a stored value is chosen by whoever holds `variable.write`, and a
 * newline or an ESC byte must not reach the reader's terminal. A secret prints
 * a marker rather than a value — there is none to print, and an empty cell would
 * read as an empty value rather than a withheld one.
 */
export function variableCells(
  rows: ReadonlyArray<VariableRow>,
): Array<{ name: string; value: string }> {
  return rows.map((row) => ({
    name: row.name,
    value: row.secret ? SECRET_MARKER : renderScalar(row.value),
  }));
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
 * The scalar types a variable can hold — the API's JSON scalars (ADR 062 §1).
 * A whole-field reference keeps its value's type, so `"retry": "${{ RETRY }}"`
 * resolves to `5`, not `"5"`, only when the value was stored as a number.
 */
export const VARIABLE_TYPES = ["string", "number", "boolean"] as const;

export type VariableType = (typeof VARIABLE_TYPES)[number];

/**
 * A JSON number, spelled strictly. `Number()` alone would accept `0x10`, a
 * blank string, or surrounding whitespace, none of which is a number anyone
 * means when they type one.
 */
const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * Turn what was typed or piped into the scalar to store, as the type asks.
 *
 * The type is stated, never guessed: an integer past 2^53 has no exact JSON
 * number, so an ID or a numeric credential would be stored with different
 * digits than were entered. It is refused rather than silently rounded.
 */
export function parseVariableValue(raw: string, type: VariableType): string | number | boolean {
  switch (type) {
    case "string":
      return raw;
    case "boolean":
      if (raw === "true" || raw === "false") {
        return raw === "true";
      }
      throw new ZitadelError(
        "E_VALIDATION",
        `Expected true or false, got ${JSON.stringify(raw)}.`,
        {
          hint: "A boolean variable is exactly `true` or `false`.",
        },
      );
    case "number": {
      const value = Number(raw);
      if (!JSON_NUMBER.test(raw) || !Number.isFinite(value)) {
        throw new ZitadelError("E_VALIDATION", `Expected a number, got ${JSON.stringify(raw)}.`, {
          hint: "Write it as a JSON number, such as 5, -1.5 or 1e3.",
        });
      }
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        throw new ZitadelError(
          "E_VALIDATION",
          `${raw} is too large to store exactly as a number.`,
          { hint: "Store it as a string, which keeps every digit." },
        );
      }
      return value;
    }
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

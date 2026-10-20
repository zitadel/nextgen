import type { GetVariable200, GetVariables200 } from "@zitadel/api/generated/model";

import type { Parsed } from "@zitadel/config/idp";

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

/** One value on the wire: a bare scalar, or `{"secret": true}` for a secret. */
export type VariableValue = NonNullable<GetVariable200["primary"]>;

/** The primary values of a read, keyed by name. */
export function primaryValues(body: GetVariables200): Record<string, VariableValue> {
  return Object.fromEntries(
    Object.entries(body).flatMap(([name, byKind]) =>
      byKind.primary === undefined ? [] : [[name, byKind.primary]],
    ),
  );
}

/**
 * Project one wire value into a row. Both endpoints answer in the same two
 * forms — a bare scalar for a non-secret, `{"secret": true}` for a secret — so
 * the collection and the single-name read share this.
 */
export function toVariableRow(name: string, value: VariableValue): VariableRow {
  return typeof value === "object" && value !== null
    ? { name, secret: true }
    : { name, secret: false, value };
}

/**
 * Project the values into rows, sorted by name so output is stable between
 * runs.
 */
export function toVariableRows(values: Record<string, VariableValue>): VariableRow[] {
  return Object.entries(values)
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
 * The server resolves `${{ NAME }}` only in an OIDC connection's `client_id`
 * and `client_secret` (`flow_sso_redirect_issuer.go`, `flow_sso_callback.go`),
 * and both must hold a string, so no reference resolves to a number or boolean
 * yet.
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
 * Turn what was typed or piped into the scalar to store, as the type asks, or
 * say what is wrong with it. The problem carries its hint, so a caller that
 * only has the problem to show loses nothing.
 *
 * The type is stated, never guessed: an integer past 2^53 has no exact JSON
 * number, so an ID or a numeric credential would be stored with different
 * digits than were entered. It is refused rather than silently rounded.
 */
export function parseVariableValue(
  raw: string,
  type: VariableType,
): Parsed<string | number | boolean> {
  const refuse = (problem: string, hint: string): Parsed<never> => ({
    ok: false,
    problem: `${problem} ${hint}`,
  });
  switch (type) {
    case "string":
      return { ok: true, value: raw };
    case "boolean":
      if (raw === "true" || raw === "false") {
        return { ok: true, value: raw === "true" };
      }
      return refuse(
        `Expected true or false, got ${JSON.stringify(raw)}.`,
        "A boolean variable is exactly `true` or `false`.",
      );
    case "number": {
      const value = Number(raw);
      if (!JSON_NUMBER.test(raw) || !Number.isFinite(value)) {
        return refuse(
          `Expected a number, got ${JSON.stringify(raw)}.`,
          "Write it as a JSON number, such as 5, -1.5 or 1e3.",
        );
      }
      if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
        return refuse(
          `${raw} is too large to store exactly as a number.`,
          "Store it as a string, which keeps every digit.",
        );
      }
      return { ok: true, value };
    }
  }
}

/**
 * Read a value from stdin, for the non-interactive path
 * (`variables set NAME --project-level --secret < secret.txt`).
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

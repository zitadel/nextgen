import type { Parsed } from "@zitadel/config/idp";

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
 * (`variable set NAME --secret < secret.txt`).
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

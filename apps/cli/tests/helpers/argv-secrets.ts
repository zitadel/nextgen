import { expect } from "vitest";

import { isSecretFlag, isSecretKey } from "@/lib/secret-key";

/** Flags whose value is `name=value` or `path:=json`. */
const ASSIGNMENTS: ReadonlySet<string> = new Set(["set", "field", "F"]);

/** Flags whose value is a JSON document. */
const DOCUMENTS: ReadonlySet<string> = new Set(["data"]);

/** The shortest value taken for a secret, so `true` or `1` is never one. */
const LEAST = 6;

/**
 * The string values anywhere under a credential's key in a parsed document.
 *
 * @param value - The document.
 * @param under - Whether an enclosing key already read as a credential's.
 * @returns The values.
 */
function secretLeaves(value: unknown, under = false): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      return secretLeaves(item, under);
    });
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, nested]) => {
      return secretLeaves(nested, under || isSecretKey(key));
    });
  }

  return under && typeof value === "string" ? [value] : [];
}

/**
 * Whether a value stands for a secret without being one: a placeholder, a
 * platform variable reference, or a shell variable.
 *
 * @param value - The value.
 * @returns Whether it is a reference.
 */
function isReference(value: string): boolean {
  return value.startsWith("<") || value.startsWith("${{") || value.startsWith("$");
}

/**
 * The secrets a command line gives: the value of a flag named like a
 * credential, the value of a `--set`/`--field` assignment to one, and the
 * strings under a credential's key in a `--data` document.
 *
 * @param args - The command line, as words.
 * @returns The secret values, which a run must never print.
 */
export function secretsIn(args: readonly string[]): string[] {
  const found: string[] = [];
  args.forEach((word, at) => {
    const flag = /^--?([A-Za-z][\w-]*)(?:=([\s\S]*))?$/.exec(word);
    if (flag === null) {
      return;
    }
    const name = flag[1] ?? "";
    const value = flag[2] ?? (args[at + 1]?.startsWith("-") ? undefined : args[at + 1]);
    if (value === undefined) {
      return;
    }
    if (ASSIGNMENTS.has(name)) {
      const assignment = /^([^=:\s]+):?=([\s\S]*)$/.exec(value);
      if (assignment !== null && isSecretKey(assignment[1] ?? "")) {
        found.push(assignment[2] ?? "");
      }
    } else if (DOCUMENTS.has(name)) {
      try {
        found.push(...secretLeaves(JSON.parse(value)));
      } catch {
        // Not a document: nothing under a key to find.
      }
    } else if (isSecretFlag(name)) {
      found.push(value);
    }
  });

  return found.filter((secret) => {
    return secret.length >= LEAST && !isReference(secret);
  });
}

/**
 * A run prints none of the secrets it was given on its command line: not in the
 * envelope, not on the screen, and not in a command it suggests running again.
 * Checked on every run a spec makes, so a command that echoes one fails in its
 * own spec.
 *
 * @param result - What the run printed.
 * @param args - The command line it ran.
 */
export function assertNoSecretEchoed(
  result: Readonly<{ stdout: string; stderr: string }>,
  args: readonly string[],
): void {
  const printed = result.stdout + result.stderr;
  for (const secret of secretsIn(args)) {
    expect(
      printed,
      `\`${args.filter((arg) => !arg.startsWith("-")).join(" ")}\` printed a secret it was given`,
    ).not.toContain(secret);
  }
}

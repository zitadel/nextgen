import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bundle, loadConfig } from "@redocly/openapi-core";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const input = resolve(repoRoot, "apps/api/api/openapi/openapi-spec.yaml");
const endpointsDirectory = resolve(packageRoot, "src/generated/endpoints");

/**
 * The vendor extension that carries the sentence a pattern's failure reads
 * as, beside the `pattern` it belongs to.
 */
const MESSAGE_KEY = "x-zitadel-pattern-message";

/**
 * Keys whose values are sample data, not schemas: a `pattern` there is an
 * example of a value, not a rule.
 */
const SAMPLE_KEYS = new Set(["example", "examples"]);

/**
 * A `new RegExp('…')` constant as orval writes it, with the pattern as the
 * escaped body of a single-quoted string.
 */
const REGEXP_CONSTANT = /export const (\w+) = new RegExp\('((?:[^'\\]|\\.)*)'\);/g;

/**
 * A string field's checks as orval writes them up to a `.regex(NAME)` call
 * that has the constant and nothing else: the type it starts from, the checks
 * before the call, and the constant.
 */
const REGEX_CHAIN = /(zod\.(?:url|string)\(\))((?:\.(?!regex\()\w+\([^()]*\))*)\.regex\((\w+)\)/g;

/**
 * What {@link collectPatternMessages} found in a spec.
 */
export type PatternMessages = {
  /**
   * The message of every pattern that has one, by pattern.
   */
  readonly messages: ReadonlyMap<string, string>;

  /**
   * Patterns no message was written for.
   */
  readonly missing: readonly string[];

  /**
   * Patterns that carry two different messages.
   */
  readonly conflicting: readonly string[];
};

/**
 * Collect the messages the spec gives its patterns.
 *
 * @remarks
 * A pattern reads the same wherever it is used, so its message is keyed by
 * the pattern. Sample data is skipped, and so is a property that is merely
 * named `pattern`.
 *
 * @param spec - The dereferenced spec; it may share objects and cycle.
 * @returns The messages by pattern, and the patterns that have none or two.
 */
export function collectPatternMessages(spec: unknown): PatternMessages {
  const messages = new Map<string, string>();
  const missing = new Set<string>();
  const conflicting = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null || seen.has(node)) {
      return;
    }
    seen.add(node);
    const record = node as Record<string, unknown>;
    const pattern = record.pattern;
    if (typeof pattern === "string") {
      const message = record[MESSAGE_KEY];
      if (typeof message !== "string" || message === "") {
        missing.add(pattern);
      } else if (messages.has(pattern) && messages.get(pattern) !== message) {
        conflicting.add(pattern);
      } else {
        messages.set(pattern, message);
      }
    }
    for (const [key, value] of Object.entries(record)) {
      if (!SAMPLE_KEYS.has(key)) {
        visit(value);
      }
    }
  };
  visit(spec);
  for (const pattern of messages.keys()) {
    missing.delete(pattern);
  }
  return { messages, missing: [...missing], conflicting: [...conflicting] };
}

/**
 * Give every `.regex()` call of a generated zod file the message of its pattern.
 *
 * @remarks
 * orval writes the pattern of a field as a constant and checks it as
 * `.regex(NAME)`, which fails as "must match pattern /…/", a regex nobody can
 * read. The constant holds the same text as the spec's `pattern`, so the
 * call is matched to its message by that text.
 *
 * The checks orval writes beside the pattern would refuse the same value a
 * second time, in words that say less, so they are left out of a field that
 * has a message: `.url()`, which also trims the value before the pattern sees
 * it, and `.min(1)` where the pattern already refuses an empty string.
 *
 * @param source - The generated zod file.
 * @param messages - The message of each pattern, by pattern.
 * @returns The file with each `.regex(NAME)` given its message.
 * @throws {@link Error} When the file holds a pattern that has no message.
 */
export function withPatternMessages(source: string, messages: ReadonlyMap<string, string>): string {
  const byConstant = new Map<string, { message: string; acceptsEmpty: boolean }>();
  const unmessaged = new Set<string>();
  for (const match of source.matchAll(REGEXP_CONSTANT)) {
    const name = match[1];
    const literal = match[2];
    if (name === undefined || literal === undefined) {
      continue;
    }
    const pattern = literal.replace(/\\([\\'])/g, "$1");
    const message = messages.get(pattern);
    if (message === undefined) {
      unmessaged.add(pattern);
    } else {
      byConstant.set(name, { message, acceptsEmpty: new RegExp(pattern).test("") });
    }
  }
  if (unmessaged.size > 0) {
    throw new Error(
      `A generated pattern has no ${MESSAGE_KEY} in the spec:\n${[...unmessaged].join("\n")}`,
    );
  }
  return source.replace(REGEX_CHAIN, (chain, _type: string, checks: string, name: string) => {
    const found = byConstant.get(name);
    if (found === undefined) {
      return chain;
    }
    const kept = found.acceptsEmpty ? checks : checks.replace(".min(1)", "");
    return `zod.string()${kept}.regex(${name}, ${JSON.stringify(found.message)})`;
  });
}

/**
 * Give the generated zod schemas the messages the spec writes for its patterns.
 *
 * @remarks
 * orval runs it after it has written the zod files (`hooks.afterAllFilesWrite`
 * in `orval.config.ts`), so it reads the spec under the same lock and in the
 * same task. It fails the generation when a pattern has no message or two, so
 * a new pattern cannot ship as a raw regex. orval's zod generator has no
 * option to carry a message; delete this when it does.
 *
 * @throws {@link Error} When a pattern in the spec has no message or two.
 */
export async function writePatternMessages(): Promise<void> {
  const config = await loadConfig({ configPath: resolve(repoRoot, "redocly.yaml") });
  const { bundle: result } = await bundle({ ref: input, config, dereference: true });
  const { messages, missing, conflicting } = collectPatternMessages(result.parsed);
  if (missing.length > 0 || conflicting.length > 0) {
    const lines = [
      ...missing.map((pattern) => `no ${MESSAGE_KEY}: ${pattern}`),
      ...conflicting.map((pattern) => `two ${MESSAGE_KEY}s: ${pattern}`),
    ];
    throw new Error(`Every pattern in the spec needs one message:\n${lines.join("\n")}`);
  }
  for (const entry of await readdir(endpointsDirectory)) {
    if (entry.endsWith(".zod.ts")) {
      const file = resolve(endpointsDirectory, entry);
      await writeFile(file, withPatternMessages(await readFile(file, "utf8"), messages));
    }
  }
}

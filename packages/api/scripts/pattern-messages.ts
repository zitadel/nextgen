import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadSpec } from "./spec.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
 * A `.regex()` call given a pattern and nothing else, which fails with the
 * pattern as its message.
 */
const BARE_REGEX_CALL = /\.regex\([^,()]*\)/g;

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
  const messaged = source.replace(
    REGEX_CHAIN,
    (chain, _type: string, checks: string, name: string) => {
      const found = byConstant.get(name);
      if (found === undefined) {
        return chain;
      }
      const kept = found.acceptsEmpty ? checks : checks.replace(".min(1)", "");
      return `zod.string()${kept}.regex(${name}, ${JSON.stringify(found.message)})`;
    },
  );
  // A pattern written in a form this does not recognise would otherwise keep
  // its raw message without a word, so every call must have come out with one.
  const bare = messaged.match(BARE_REGEX_CALL);
  if (bare !== null) {
    throw new Error(
      `A generated .regex() call was left without a message, which orval may now write differently:\n${[...new Set(bare)].join("\n")}`,
    );
  }
  return messaged;
}

/**
 * Refuse a spec whose patterns do not each have exactly one message.
 *
 * @remarks
 * A pattern reads the same wherever it is used, so a message belongs to the
 * pattern's text: two fields that share a regex share its wording, and the
 * spec fails when they word it differently.
 *
 * @param found - What {@link collectPatternMessages} found in the spec.
 * @throws {@link Error} Naming each pattern that has no message, or two different ones.
 */
export function assertEveryPatternHasOneMessage(found: PatternMessages): void {
  if (found.missing.length === 0 && found.conflicting.length === 0) {
    return;
  }
  const lines = [
    ...found.missing.map((pattern) => `no ${MESSAGE_KEY}: ${pattern}`),
    ...found.conflicting.map((pattern) => `different ${MESSAGE_KEY}s on one pattern: ${pattern}`),
  ];
  throw new Error(`Every pattern in the spec needs one message:\n${lines.join("\n")}`);
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
  const found = collectPatternMessages(await loadSpec());
  assertEveryPatternHasOneMessage(found);
  for (const entry of await readdir(endpointsDirectory)) {
    if (entry.endsWith(".zod.ts")) {
      const file = resolve(endpointsDirectory, entry);
      const current = await readFile(file, "utf8");
      const messaged = withPatternMessages(current, found.messages);
      if (messaged !== current) {
        await writeFile(file, messaged);
      }
    }
  }
}

import ignore from "ignore";

import { isSecretPath } from "@/lib/secret-paths";

/**
 * A path the root `.gitignore` must ignore or must keep, and the line that
 * makes it so when the file as it stands does not.
 */
export interface GitignoreRule {
  readonly path: string;
  readonly ignored: boolean;
  readonly entry: string;
}

/**
 * What the files setup writes need from the root `.gitignore`: each file
 * {@link isSecretPath} says must never be committed ignored, and
 * `.env.example`, which names the variables without their values and is meant
 * to be committed, kept.
 *
 * @remarks
 * Each rule names a path, not a line, because a generator's own lines may
 * already cover it (`.env.*`, `*.local`) or undo it (`.env*` after
 * `!.env.example`), and git lets the last matching line win. The rules that
 * ignore come first: an entry appended for one of them can re-ignore a kept
 * path, which the kept path's own entry, appended after it, then undoes.
 * `eject` renames each env file to `<name>.ejected-<timestamp>`, which holds
 * the same secrets.
 */
export const ZITADEL_GITIGNORE: ReadonlyArray<GitignoreRule> = [
  rule(".zitadel/secret", ".zitadel/secret"),
  rule(".env", ".env*"),
  rule(".env.local", ".env*"),
  rule(".env.development.local", ".env*"),
  rule(".env.local.ejected-2026-01-01T00-00-00-000Z", ".env*"),
  rule(".env.example", "!.env.example"),
];

/**
 * @param text - The root `.gitignore` as it stands.
 * @param rules - What it must hold.
 * @returns The rules it breaks, in their order.
 */
export function brokenRules(
  text: string,
  rules: ReadonlyArray<GitignoreRule> = ZITADEL_GITIGNORE,
): ReadonlyArray<GitignoreRule> {
  return rules.filter((rule) => {
    return !holds(text, [], rule);
  });
}

/**
 * The fewest entries that, appended to `text` in order, make every rule hold.
 * Nothing already there is moved or removed, so appending none of them leaves
 * the file as it is, and running this on its own result asks for nothing.
 *
 * @param text - The root `.gitignore` as it stands.
 * @param rules - What it must hold.
 * @returns The entries to append; empty when every rule holds.
 */
export function entriesToAppend(
  text: string,
  rules: ReadonlyArray<GitignoreRule> = ZITADEL_GITIGNORE,
): ReadonlyArray<string> {
  const appended: string[] = [];
  for (const rule of rules) {
    if (!holds(text, appended, rule)) {
      appended.push(rule.entry);
    }
  }
  return appended;
}

function holds(text: string, appended: ReadonlyArray<string>, rule: GitignoreRule): boolean {
  return (
    ignore()
      .add(text)
      .add([...appended])
      .ignores(rule.path) === rule.ignored
  );
}

function rule(path: string, entry: string): GitignoreRule {
  return { path, ignored: isSecretPath(path), entry };
}

import ignore from "ignore";

import { EnvFile } from "./env-file";
import { SecretPath } from "./secret-path";

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
 * An environment and an eject time no `.gitignore` names on its own, so only a
 * line that ignores every environment's file, or every backup, meets the rules
 * that stand for them.
 */
const ANY_ENVIRONMENT = "any-environment";
const ANY_STAMP = "any-time";

/**
 * One rule: `path` is ignored when it is a secret, and `entry` is the line that
 * makes it so.
 *
 * @param path - A path the root `.gitignore` is held to.
 * @param entry - The line that settles it.
 * @returns The rule.
 */
function ruleFor(path: string, entry: string): GitignoreRule {
  return { path, ignored: new SecretPath(path).isSecret(), entry };
}

/**
 * What the files the CLI writes need from the root `.gitignore`: each one
 * {@link SecretPath.isSecret} says must never be committed ignored, and
 * `.env.example`, which names the variables without their values and is meant
 * to be committed, kept.
 *
 * Each rule names a path, not a line, because a generator's own lines may
 * already cover it (`.env.*`, `*.local`) or undo it (`.env*` after
 * `!.env.example`), and git lets the last matching line win. A file whose name
 * varies (an environment's, an eject backup's) is named by a sample no list
 * holds, taken from the function that names the file. The rules that ignore
 * come first: an entry appended for one of them can re-ignore a kept path,
 * which the kept path's own entry, appended after it, then undoes.
 */
const ZITADEL_RULES: ReadonlyArray<GitignoreRule> = [
  ruleFor(".zitadel/secret", ".zitadel/secret"),
  ruleFor(".env", ".env*"),
  ruleFor(".env.local", ".env*"),
  ruleFor(EnvFile.nameFor("development"), ".env*"),
  ruleFor(EnvFile.nameFor(ANY_ENVIRONMENT), ".env*"),
  ruleFor(EnvFile.backupOf(".env.local", ANY_STAMP), ".env*"),
  ruleFor(EnvFile.backupOf(EnvFile.nameFor("development"), ANY_STAMP), ".env*"),
  ruleFor(".env.example", "!.env.example"),
];

/**
 * What a root `.gitignore` must hold, and what it takes to make it hold that.
 */
export class Gitignore {
  /** What it must hold. */
  readonly rules: ReadonlyArray<GitignoreRule>;

  /**
   * @param rules - What it must hold; what the files the CLI writes need when
   *   left out.
   */
  constructor(rules: ReadonlyArray<GitignoreRule> = ZITADEL_RULES) {
    this.rules = rules;
  }

  /**
   * The rules a `.gitignore` breaks.
   *
   * @param text - The root `.gitignore` as it stands.
   * @returns The rules it breaks, in their order.
   */
  broken(text: string): ReadonlyArray<GitignoreRule> {
    return this.rules.filter((rule) => {
      return !Gitignore.holds(text, [], rule);
    });
  }

  /**
   * The fewest entries that, appended to `text` in order, make every rule
   * hold. Nothing already there is moved or removed, so appending none of them
   * leaves the file as it is, and running this on its own result asks for
   * nothing.
   *
   * @param text - The root `.gitignore` as it stands.
   * @returns The entries to append; empty when every rule holds.
   */
  entriesToAppend(text: string): ReadonlyArray<string> {
    const appended: string[] = [];
    for (const rule of this.rules) {
      if (!Gitignore.holds(text, appended, rule)) {
        appended.push(rule.entry);
      }
    }
    return appended;
  }

  /**
   * Whether `text`, with `appended` after it, settles a rule.
   *
   * @param text - The root `.gitignore` as it stands.
   * @param appended - The entries added after it.
   * @param rule - The rule.
   * @returns `true` when the rule's path is ignored, or kept, as it demands.
   */
  private static holds(
    text: string,
    appended: ReadonlyArray<string>,
    rule: GitignoreRule,
  ): boolean {
    return (
      ignore()
        .add(text)
        .add([...appended])
        .ignores(rule.path) === rule.ignored
    );
  }
}

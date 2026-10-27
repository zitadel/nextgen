import { consola, type ConsolaReporter } from "consola";
import { format } from "node:util";
import pc from "picocolors";

import type { Chain } from "./chain";
import { GUIDE, MARK } from "./marks";

/**
 * A bridge for the narration the CLI still writes with `consola`.
 *
 * Most of the CLI says what it is doing with `consola.info` and friends.
 * Rewriting every one of those into a {@link Wizard} task at once would be a
 * large, risky change, so while a chain is open those lines are drawn inside it
 * with its gutter and the mark their level deserves. A command that has been
 * moved to tasks and steps needs none of this; one that has not still looks
 * like the others.
 *
 * It is installed once per invocation by `BaseCommand`, and only when someone
 * is watching: with nobody there, consola prints its own lines as before and
 * `--json` silences it by level.
 */
const MARKS: Readonly<Record<string, string>> = {
  success: MARK.done,
  ready: MARK.done,
  info: pc.cyan("ℹ"),
  start: pc.cyan("◐"),
  warn: MARK.warning,
  error: MARK.failed,
  fail: MARK.failed,
  fatal: MARK.failed,
  debug: pc.dim("·"),
  trace: pc.dim("·"),
};

export function bridgeNarration(chain: Chain): void {
  const reporter: ConsolaReporter = {
    log: (entry) => {
      const text = format(...entry.args);
      if (text.trim() === "") {
        return;
      }
      chain.narrate(MARKS[entry.type] ?? GUIDE, text.replace(/^\n+/, ""));
    },
  };
  consola.setReporters([reporter]);
}

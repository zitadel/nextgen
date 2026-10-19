import { consola } from "consola";

/**
 * Warnings reported during this invocation. The CLI runs one command per
 * process, so a module-level list is the invocation's list; `BaseCommand`
 * clears it when a command starts and drains it into the envelope when the
 * command emits.
 */
const reported: string[] = [];

/**
 * Report a warning. This is the only way the CLI warns: never call
 * `consola.warn` directly (see `apps/cli/AGENTS.md`).
 *
 * A terminal shows the warning at once, which matters when it comes before a
 * long wait. `--json` silences that output, so the warning is also kept for
 * the envelope's `warnings`, and both kinds of reader see it.
 */
export function reportWarning(message: string): void {
  consola.warn(message);
  reported.push(message);
}

/** Take every warning reported so far, leaving none behind. */
export function takeReportedWarnings(): string[] {
  return reported.splice(0);
}

import type { Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { log } from "@/lib/log";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"target" | "candidate" | "preview" | "options" | "summary" | "given">;

/**
 * Settles the change to write, and checks that saving it would be accepted.
 */
export class BuildChange extends WizardStep<"change", Fact<"change">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "change";

  /**
   * Make the change again when a development run answered other endpoints, and
   * check it.
   *
   * @remarks
   * The change is the preview, or the same change made again with the endpoints
   * a development run answered. The endpoints change only a new connection's
   * body, never which files the change writes.
   *
   * The credentials go before the files: saving writes the connection first, so
   * a write that then fails would leave a connection on disk whose credentials
   * were never stored, and the rerun would take it as reused and not ask for
   * them again. Saving's own refusals are checked here, before anything is
   * published, so a path it would refuse leaves the project's variables alone
   * too.
   *
   * @param needs - What was read and decided.
   * @returns The change.
   * @throws {@link ZitadelError} When saving the change would be refused.
   */
  async run(needs: Needs): Promise<Fact<"change">> {
    const change =
      needs.given.endpoints === undefined
        ? needs.preview
        : needs.target.config.connections.enable(
            needs.target.schema,
            needs.candidate.withEndpoints(needs.given.endpoints).document,
            needs.options,
          );
    if (needs.summary.reused) {
      log.done(`Reusing ${escapeControlCharacters(needs.summary.connection.path)}`);
    }
    await change.check(needs.target.store);
    return {
      change,
    };
  }
}

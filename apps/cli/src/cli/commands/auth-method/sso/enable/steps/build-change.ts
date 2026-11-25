import type { Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { log } from "@/lib/ui";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";
import { ZitadelConfigEditBreaksFlowsError, ZitadelConfigFlowsUncheckedError } from "@/lib/zitadel";
import { type Refusal, refusalError } from "@/cli/core/refusal";

/**
 * What a change that would break a login flow is refused for.
 */
const EDIT_BREAKS_FLOWS_REFUSAL = {
  message: "{message}",
  hint: "{hint}",
  details: "{details}",
} as const satisfies Refusal;

/**
 * What a change is refused for when the login flows cannot be checked against it.
 */
const FLOWS_UNCHECKED_REFUSAL = {
  message: "{message}",
  hint: "Fix those errors first (`zitadel deploy --dry-run` reports them too), then run the command again.",
  details: "{details}",
  next: [
    {
      id: "deploy",
      flags: {
        dryRun: true,
      },
    },
  ],
} as const satisfies Refusal;

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
    // biome-ignore lint/plugin: assigned inside the try that guards the call, read after it
    let change: Needs["preview"];
    try {
      change =
        needs.given.endpoints === undefined
          ? needs.preview
          : needs.target.config.connections.enable(
              needs.target.schema,
              needs.candidate.withEndpoints(needs.given.endpoints).document,
              needs.options,
            );
    } catch (error) {
      if (error instanceof ZitadelConfigFlowsUncheckedError) {
        throw refusalError(FLOWS_UNCHECKED_REFUSAL, {
          message: error.message,
          details: error.details ?? null,
        });
      }
      if (error instanceof ZitadelConfigEditBreaksFlowsError) {
        throw refusalError(EDIT_BREAKS_FLOWS_REFUSAL, {
          message: error.message,
          hint: error.hint ?? "",
          details: error.details ?? null,
        });
      }
      throw error;
    }
    if (needs.summary.reused) {
      log.debug(`Reusing ${escapeControlCharacters(needs.summary.connection.path)}`);
    }
    await change.check(needs.target.store);
    return {
      change,
    };
  }
}

import type { Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { log } from "@/lib/log";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from the steps before it.
 */
type Needs = Fact<"target" | "provider" | "summary">;

/**
 * Says what the run addresses and what to register with the provider.
 *
 * @remarks
 * Said before a dry run returns, so a preview is enough to register the client.
 */
export class IntroduceProvider extends WizardStep<"introduce", object, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "introduce";

  /**
   * Print the introduction: what the run addresses and what to register with
   * the provider.
   *
   * @remarks
   * A custom provider has no console to send the developer to: it is theirs, and
   * the issuer they gave is the only address known.
   *
   * @param needs - What was read and decided.
   * @returns Nothing is added.
   */
  async run(needs: Needs): Promise<object> {
    log.info(
      `Editing ${escapeControlCharacters(needs.target.schema.path)}${needs.target.schema.methods.length > 0 ? `, which offers ${escapeControlCharacters(needs.target.schema.methods.join(", "))}` : ""}`,
    );
    if (!needs.summary.reused) {
      log.info(
        `${escapeControlCharacters(needs.provider.displayName, { keepLayout: false })} needs an OAuth application.`,
      );
    }
    log.info(
      `Callback URI   ${escapeControlCharacters(needs.summary.callbackUri, { keepLayout: false })}`,
    );
    for (const uri of needs.summary.deployedCallbackUris) {
      log.info(`Callback URI   ${escapeControlCharacters(uri, { keepLayout: false })}`);
    }
    if (needs.summary.previewCallbackUris.length > 0) {
      log.info(
        "Each preview URL needs its own callback URI at the provider, since it takes no wildcards:",
      );
      for (const uri of needs.summary.previewCallbackUris) {
        log.info(`  ${escapeControlCharacters(uri, { keepLayout: false })}`);
      }
    }
    if (!needs.summary.reused && needs.provider.consoleUrl === undefined) {
      log.info(
        `Register it as a client at ${escapeControlCharacters(needs.provider.issuer)}, with the callback URI above.`,
      );
    }
    if (!needs.summary.reused && needs.provider.consoleUrl !== undefined) {
      log.info(`Create it at   ${escapeControlCharacters(needs.provider.consoleUrl)}`);
    }

    return {};
  }
}

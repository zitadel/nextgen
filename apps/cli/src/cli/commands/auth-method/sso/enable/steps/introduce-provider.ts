import { log } from "@/lib/log";
import { escapeControlCharacters } from "@/lib/terminal-text";

import type { IdpProvider } from "@zitadel/config/idp";

import type { SchemaTarget } from "@/cli/commands/auth-method/command";
import { WizardStep } from "@/lib/wizard";

import type { Summary } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * What the step reads from the steps before it.
 */
type Needs = Readonly<{ target: SchemaTarget; provider: IdpProvider; summary: Summary }>;

/**
 * Says what the run addresses and what to register with the provider.
 *
 * @remarks
 * Said before a dry run returns, so a preview is enough to register the client.
 */
export class IntroduceProvider extends WizardStep<"introduce", object, Needs> {
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
   * @param _services - What the command provides.
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

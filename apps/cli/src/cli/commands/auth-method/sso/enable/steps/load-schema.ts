import type { SchemaTarget } from "@/cli/commands/auth-method/command";
import { WizardStep } from "@/lib/wizard";

import type { EnableInput, EnableServices } from "@/cli/commands/auth-method/sso/enable/shared";

/**
 * Reads the schema the provider is added to, and refuses one no flow offers a
 * sign-in button on.
 */
export class LoadSchema extends WizardStep<
  "target",
  Readonly<{ target: SchemaTarget }>,
  EnableInput,
  EnableServices
> {
  readonly key = "target";

  /**
   * Load the schema and its flows.
   *
   * @remarks
   * Refused before anything is asked: a provider no flow offers is no sign-in
   * button however well everything else goes.
   *
   * @param needs - What the run starts from.
   * @param services - What the command provides.
   * @returns What the run read.
   * @throws {@link ZitadelError} When the schema cannot be chosen, or no flow
   *   can offer the provider.
   */
  async run(
    needs: EnableInput,
    services: EnableServices,
  ): Promise<Readonly<{ target: SchemaTarget }>> {
    const target = await services.loadSchemaTarget(needs.flags);
    target.config.flows.resolveForSso(target.schema);
    return {
      target,
    };
  }
}

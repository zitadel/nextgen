import type { SchemaTarget } from "@/cli/commands/auth-method/command";
import type { EnableInput } from "@/cli/commands/auth-method/sso/enable/shared";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step is given by the command.
 */
type Deps = Readonly<{
  /**
   * Reads the schema the run changes and everything around it.
   *
   * @param flags - The flags the command admitted.
   * @returns What the run read.
   */
  loadSchemaTarget(flags: EnableInput["flags"]): Promise<SchemaTarget>;
}>;

/**
 * Reads the schema the provider is added to, and refuses one no flow offers a
 * sign-in button on.
 */
export class LoadSchema extends WizardStep<
  "target",
  Readonly<{ target: SchemaTarget }>,
  EnableInput
> {
  readonly key = "target";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Load the schema and its flows.
   *
   * @remarks
   * Refused before anything is asked: a provider no flow offers is no sign-in
   * button however well everything else goes.
   *
   * @param needs - What the run starts from.
   * @returns What the run read.
   * @throws {@link ZitadelError} When the schema cannot be chosen, or no flow
   *   can offer the provider.
   */
  async run(needs: EnableInput): Promise<Readonly<{ target: SchemaTarget }>> {
    const target = await this.deps.loadSchemaTarget(needs.flags);
    target.config.flows.resolveForSso(target.schema);
    return {
      target,
    };
  }
}

import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { WizardStep } from "@/lib/wizard";
import { ZitadelConfigFlowMissingError, ZitadelConfigRegionUneditableError } from "@/lib/zitadel";

/**
 * What a schema no login flow runs against is refused for.
 */
const FLOW_MISSING_REFUSAL = {
  code: "E_NOT_FOUND",
  message: "{message}",
  hint: "The provider is offered by a flow, and none of the files under .zitadel/flows/ names this schema. Check that the flow's user_schema names the schema's objectType.",
  details: {
    schema: "{path}",
  },
} as const satisfies Refusal;

/**
 * What a flow region the edit writes, and that is not the shape it writes, is
 * refused for.
 */
const REGION_UNEDITABLE_REFUSAL = {
  message: "{message}",
  hint: "This command edits that region, and it is not the shape it edits. Fix it against the dialect in .zitadel/meta/, then run the command again.",
  details: {
    file: "{path}",
    region: "{region}",
  },
} as const satisfies Refusal;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "loadSchemaTarget">;

/**
 * Reads the schema the provider is added to, and refuses one no flow offers a
 * sign-in button on.
 */
export class LoadSchema extends WizardStep<"target", Fact<"target">, Fact<"flags">> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
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
  async run(needs: Fact<"flags">): Promise<Fact<"target">> {
    const target = await this.deps.loadSchemaTarget(needs.flags);
    try {
      target.config.flows.resolveForSso(target.schema);
    } catch (error) {
      if (error instanceof ZitadelConfigFlowMissingError) {
        throw refusalError(FLOW_MISSING_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      if (error instanceof ZitadelConfigRegionUneditableError) {
        throw refusalError(REGION_UNEDITABLE_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      throw error;
    }
    return {
      target,
    };
  }
}

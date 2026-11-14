import { CUSTOM_PROVIDER } from "@zitadel/config/idp";

import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import {
  customExample,
  customFlagValues,
  ENABLE_FLAG_KEYS,
  ENABLE_FLAG_NAMES,
  selectionFromFlags,
} from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "dryRun" | "nonInteractive">;

/**
 * Works out how the flags choose a provider, before anything is read or asked.
 */
export class ChooseProvider extends WizardStep<"choice", Fact<"choice">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "choice";

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
   * Read the flags that name the provider and describe a custom one.
   *
   * @remarks
   * Made from the flags before anything else is read, so a provider the flags
   * get wrong is refused first. A person at a terminal is asked for the custom
   * settings they left out, but later: here the ones they did give are only
   * checked, and each was refused under its own flag on its way in, so a run
   * that will ask for the rest has nothing left to check. Being turned away
   * after typing a secret would mean typing it again. A script, a dry run or
   * `--non-interactive` is held to the flags and told which are missing.
   *
   * @param needs - What the run starts from.
   * @returns How the flags choose a provider, with no provider yet when a
   *   person will be asked for the rest.
   * @throws {@link ZitadelError} When the provider is unknown, a custom setting
   *   accompanies a catalog provider, or a script leaves out a custom
   *   connection's setting.
   */
  async run(needs: Needs): Promise<Fact<"choice">> {
    const provider = String(needs.flags.provider);
    const values = customFlagValues(needs.flags, ENABLE_FLAG_KEYS);
    const complete =
      values.slug !== undefined && values.displayName !== undefined && values.issuer !== undefined;
    if (
      provider === CUSTOM_PROVIDER &&
      !this.deps.nonInteractive &&
      !this.deps.dryRun &&
      !complete
    ) {
      return {
        choice: {
          selection: undefined,
          values,
        },
      };
    }

    return {
      choice: {
        selection: selectionFromFlags(
          provider,
          values,
          ENABLE_FLAG_NAMES,
          customExample(ENABLE_FLAG_NAMES),
        ),
        values,
      },
    };
  }
}

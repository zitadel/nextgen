import { ZitadelError } from "@/lib/errors";
import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "orca" | "app" | "scaffoldedFramework" | "answers">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<
  SetupServices,
  "ask" | "cwd" | "dryRun" | "nonInteractive" | "serverFlag" | "suggest" | "ui"
>;

/**
 * "Would you like to set up Zitadel in this `<framework>` app?" — the
 * wizard's first question in an app setup found, asked before anything in it
 * changes. Accepting leaves answers unchanged.
 *
 * Declining throws `E_UNSUPPORTED_PROJECT_SHAPE`, and the hint points at the
 * one way to a different app: running setup in its directory. `--framework`
 * is no way out, because setup refuses a framework other than the one it
 * detects here (`E_CONFLICT`), so the hint does not offer it.
 *
 * Skipped when the developer already named the framework, by picking it to
 * scaffold or with `--framework`: detection then only read back their own
 * answer.
 */
export class ConfirmFramework extends WizardStep<"frameworkConfirm", Fact<"answers">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "frameworkConfirm";

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
   * Ask whether to set up Zitadel in the detected app, or leave the answers as they are when
   * nothing can be asked.
   *
   * @param needs - The flags, the app and the answers so far.
   * @returns The answers, unchanged.
   * @throws {@link ZitadelError} When the developer declines.
   */
  async run(needs: Needs): Promise<Fact<"answers">> {
    const { answers, app, flags, orca, scaffoldedFramework } = needs;
    if (
      this.deps.nonInteractive ||
      this.deps.dryRun ||
      scaffoldedFramework ||
      flags.framework !== undefined
    ) {
      return {
        answers,
      };
    }
    const displayName = orca.displayName(app.framework);
    if (
      (await this.deps.ask.yesNo({
        name: "confirm the framework",
        message: `Would you like to set up Zitadel in this ${displayName} app?`,
        initialValue: true,
      })) === false
    ) {
      throw new ZitadelError(
        "E_UNSUPPORTED_PROJECT_SHAPE",
        `Setup stopped before changing this ${displayName} app`,
        {
          hint: "To set up another app, run setup in its directory, or pass --cwd with that directory.",
        },
      );
    }
    return {
      answers,
    };
  }
}

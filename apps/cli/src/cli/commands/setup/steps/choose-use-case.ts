import { SETUP_USE_CASES } from "@zitadel/config/defaults";

import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags" | "orca" | "app" | "scaffoldedFramework" | "answers">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "ask" | "dryRun" | "nonInteractive">;

/**
 * "Which fields should registration collect?" — picks the use case,
 * which owns the schema field set the scaffold collects. Orthogonal to the
 * sign-in preset, so this asks first: what a user *is* before *how* they sign
 * in. `--use-case` is authoritative; non-interactive runs keep the minimal
 * default seeded by the command.
 */
export class ChooseUseCase extends WizardStep<"useCase", Fact<"answers">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "useCase";

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
   * Ask which fields registration collects, or leave the answers as they are when nothing can be
   * asked.
   *
   * @remarks
   * The labels are the field sets themselves, so all three stay comparable whichever option is
   * highlighted (a hint shows only for the highlighted one). The internal use-case values are
   * unchanged: the use case is recorded in `zitadel.json`, and `--use-case` still names them. The
   * message notes the fields stay editable after setup — the scaffolded schema/flow are the source
   * of truth — and stays short enough for one line of an 80-column terminal. That every set
   * includes email, the labels already say.
   *
   * @param needs - The flags, the app and the answers so far.
   * @returns The answers, with the use case settled.
   */
  async run(needs: Needs): Promise<Fact<"answers">> {
    const { answers, flags } = needs;
    if (this.deps.nonInteractive || this.deps.dryRun || flags.useCase !== undefined) {
      return {
        answers,
      };
    }
    return {
      answers: {
        ...answers,
        useCase: await this.deps.ask.select({
          name: "use case",
          message: "Which fields should registration collect? You can change them later.",
          initialValue: answers.useCase,
          options: SETUP_USE_CASES.map((useCase) => {
            return {
              value: useCase,
              label: {
                minimal: "Email only",
                consumer: "Email, first name and last name",
                business: "Email, first name, last name and company name",
              }[useCase],
            };
          }),
        }),
      },
    };
  }
}

import { providerOf } from "@zitadel/config/idp";

import type { Fact, SetupServices, SsoDraft } from "@/cli/commands/setup/shared";
import { asksForClaims, ClaimQuestions, NO_CLAIM_REQUEST, seedMapping } from "@/lib/idp";
import { WizardStep } from "@/lib/wizard";
import { Connection, ZitadelConfig } from "@/lib/zitadel";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"answers">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "ask" | "dryRun" | "nonInteractive" | "ui">;

/**
 * Shows what each chosen provider fills by default and asks whether other
 * claims should be mapped, against the default schema the answers so far will
 * scaffold.
 *
 * @remarks
 * `--sso-claim` is the whole answer when given, as `--preset` is for its
 * question; a run nobody can answer, and a preview, take the defaults.
 */
export class MapClaims extends WizardStep<"claims", Fact<"answers">, Needs> {
  readonly key = "claims";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Ask about the claims of each provider that the flags left out.
   *
   * @param needs - The answers so far.
   * @param this.deps - What the command provides.
   * @returns The answers, with what each provider maps.
   */
  async run(needs: Needs): Promise<Fact<"answers">> {
    if (this.deps.nonInteractive || this.deps.dryRun) {
      return {
        answers: needs.answers,
      };
    }
    return {
      answers: {
        ...needs.answers,
        sso: await this.askAbout(needs.answers, needs.answers.sso),
      },
    };
  }

  /**
   * Ask about each provider in turn, since a person answers one question at a
   * time.
   *
   * @param answers - The answers so far, which decide the schema.
   * @param drafts - The providers still to ask about.
   * @returns Each provider with what it maps beyond the defaults.
   */
  private async askAbout(
    answers: Needs["answers"],
    drafts: readonly SsoDraft[],
  ): Promise<readonly SsoDraft[]> {
    const [draft, ...rest] = drafts;
    if (draft === undefined) {
      return [];
    }
    if (asksForClaims(draft.claimRequest ?? NO_CLAIM_REQUEST)) {
      return [draft, ...(await this.askAbout(answers, rest))];
    }
    const provider = providerOf(draft.selection);
    const template = ZitadelConfig.defaultSchema(answers.preset, answers.useCase);
    const state = seedMapping(
      Connection.forProvider(provider, template, draft.endpoints),
      template,
    );
    const claimRequest = await new ClaimQuestions({
      ask: this.deps.ask,
      show: (title, lines) => {
        this.deps.ui.note(title, lines);
      },
      say: (line) => {
        this.deps.ui.say(line);
      },
    }).ask(state, provider.displayName);
    return [{ ...draft, claimRequest }, ...(await this.askAbout(answers, rest))];
  }
}

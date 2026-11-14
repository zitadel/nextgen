import type { EnableServices, Fact } from "@/cli/commands/auth-method/sso/enable/shared";
import { applyRequest, asksForClaims, choiceOf, ClaimQuestions, claimsOrRefuse } from "@/lib/idp";
import { log } from "@/lib/log";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";

/**
 * How `--verified-claim` is spelled, for the note about a replaced default.
 */
const VERIFIED_FLAG = "--verified-claim";

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"provider" | "claimRequest" | "mapping" | "claims">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<EnableServices, "ask" | "nonInteractive">;

/**
 * Shows what the provider fills by default and asks whether other claims should
 * be mapped, once the credentials are in.
 *
 * @remarks
 * Flags that name claims are the whole answer, as `--preset` is for its
 * question, and a run nobody can answer takes the defaults.
 */
export class AskClaims extends WizardStep<"answered", Fact<"answered">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "answered";

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
   * Ask for the claims to map, and say what the answers changed that the flags
   * had not.
   *
   * @param needs - The provider and what the flags settled.
   * @returns What the connection is written with: what the flags settled when
   *   nothing was asked, otherwise what the answers settled.
   * @throws {@link ZitadelError} With `E_VALIDATION` when an answer cannot be
   *   mapped, which the questions are built not to allow.
   */
  async run(needs: Needs): Promise<Fact<"answered">> {
    if (
      needs.mapping === undefined ||
      asksForClaims(needs.claimRequest) ||
      this.deps.nonInteractive
    ) {
      return {
        answered: needs.claims,
      };
    }
    const request = await new ClaimQuestions({
      ask: this.deps.ask,
      show: (title, lines) => {
        log.info([title, ...lines].join("\n"));
      },
      say: (line) => {
        log.info(line);
      },
    }).ask(needs.mapping, needs.provider.displayName);
    const answered = choiceOf(claimsOrRefuse(applyRequest(needs.mapping, request)), VERIFIED_FLAG);
    const heard = new Set(needs.claims?.notes);
    for (const note of answered.notes) {
      if (!heard.has(note)) {
        reportWarning(note);
      }
    }
    return {
      answered,
    };
  }
}

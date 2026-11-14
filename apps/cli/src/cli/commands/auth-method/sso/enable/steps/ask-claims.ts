import type { IdpProvider } from "@zitadel/config/idp";

import {
  applyRequest,
  asksForClaims,
  choiceOf,
  ClaimQuestions,
  type ClaimRequest,
  claimsOrRefuse,
  type MappingState,
} from "@/lib/idp";
import { log } from "@/lib/log";
import { escapeControlCharacters } from "@/lib/terminal-text";
import type { Questions } from "@/lib/ui";
import { reportWarning } from "@/lib/warnings";
import { WizardStep } from "@/lib/wizard";
import type { ClaimChoice } from "@/lib/zitadel";

/**
 * How `--verified-claim` is spelled, for the note about a replaced default.
 */
const VERIFIED_FLAG = "--verified-claim";

/**
 * What the step reads from the steps before it.
 */
type Needs = Readonly<{
  provider: IdpProvider;
  claimRequest: ClaimRequest;
  mapping: MappingState | undefined;
  claims: ClaimChoice | undefined;
}>;

/**
 * What the step is given by the command.
 */
type Deps = Readonly<{
  /**
   * How a question is asked.
   */
  ask: Questions;

  /**
   * Whether the run may not ask anything.
   */
  nonInteractive: boolean;
}>;

/**
 * Shows what the provider fills by default and asks whether other claims should
 * be mapped, once the credentials are in.
 *
 * @remarks
 * Flags that name claims are the whole answer, as `--preset` is for its
 * question, and a run nobody can answer takes the defaults.
 */
export class AskClaims extends WizardStep<
  "answered",
  Readonly<{ answered: ClaimChoice | undefined }>,
  Needs
> {
  readonly key = "answered";

  /**
   * @param deps - What the command gives the step.
   */
  private readonly deps: Deps;

  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Ask for the claims to map, and say what the answers changed that the flags
   * had not.
   *
   * @param needs - The provider and what the flags settled.
   * @param this.deps - What the command provides.
   * @returns What the connection is written with: what the flags settled when
   *   nothing was asked, otherwise what the answers settled.
   * @throws {@link ZitadelError} With `E_VALIDATION` when an answer cannot be
   *   mapped, which the questions are built not to allow.
   */
  async run(needs: Needs): Promise<Readonly<{ answered: ClaimChoice | undefined }>> {
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
        log.info(
          [title, ...lines]
            .map((line) => {
              return escapeControlCharacters(line, { keepLayout: false });
            })
            .join("\n"),
        );
      },
      say: (line) => {
        log.info(escapeControlCharacters(line, { keepLayout: false }));
      },
    }).ask(
      needs.mapping,
      escapeControlCharacters(needs.provider.displayName, { keepLayout: false }),
    );
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

import { isChallengeId } from "../../claim-state";
import { refuses, type Rule } from "../rules";

/**
 * The challenge id goes back to the platform and into the suggestions a run
 * makes, so it has to be the contract's shape before anything is asked or sent.
 */
export const challengeIdRules: readonly Rule[] = [
  refuses(
    (view) => {
      const challengeId = view.flags["challenge-id"];
      return typeof challengeId === "string" && !isChallengeId(challengeId);
    },
    {
      message:
        "--challenge-id takes the challenge_id a `claim --no-wait` run returned, which starts with ch_.",
      next: ["claim --no-wait"],
    },
  ),
];

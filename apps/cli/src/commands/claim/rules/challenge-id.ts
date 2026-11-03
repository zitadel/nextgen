import { getClaimStatusQueryChallengeIdRegExp } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";

import { type Rule, refuses } from "../../../lib/oclif/rules";

/** Whether `value` has the shape the claim contract gives a `challenge_id`. */
export function isChallengeId(value: string): boolean {
  return getClaimStatusQueryChallengeIdRegExp.test(value);
}

/**
 * Refuses a `--challenge-id` that is not the contract's shape. The id goes back
 * to the platform and into the suggestions a run makes, so it has to be right
 * before anything is asked or sent.
 */
export const challengeIdRule: Rule = refuses(
  (view) => {
    const challengeId = view.flags.challengeId;
    return typeof challengeId === "string" && !isChallengeId(challengeId);
  },
  {
    message:
      "--challenge-id takes the challenge_id a `claim --no-wait` run returned, which starts with ch_.",
    next: ["claim --no-wait"],
  },
);

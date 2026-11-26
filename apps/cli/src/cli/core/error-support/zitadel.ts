import {
  type FlowMethodUse,
  PASSWORD_FIELD,
  type ToggleableMethod,
  ZitadelConfigFlowMethodInUseError,
  ZitadelConfigFlowUncheckedError,
  ZitadelConfigNothingToDeployError,
  ZitadelConfigOutcomeActionClashError,
  ZitadelConfigPasswordPolicyInvalidError,
  ZitadelConfigRenameActionClashError,
  ZitadelConfigRenameRouteLossError,
  ZitadelConfigSignupPolicyInvalidError,
} from "@/lib/zitadel";

import { type Advice, derived, type Wording } from "./wording";

/** How {@link ZitadelConfigFlowMethodInUseError} is refused. */
const FLOW_METHOD_IN_USE_ADVICE = {
  hint: "Edit those steps first; login flows are not edited for you. From each step, remove its {removed}.{deletion} `zitadel deploy --dry-run` checks the edited flow; then run the command again.",
  next: [
    {
      id: "deploy",
      flags: {
        dryRun: true,
      },
    },
  ],
} as const satisfies Advice;

/** How {@link ZitadelConfigFlowUncheckedError} is refused. */
const FLOW_UNCHECKED_ADVICE = {
  hint: "Fix those errors first (`zitadel deploy --dry-run` reports them too), then run the command again.",
  next: [
    {
      id: "deploy",
      flags: {
        dryRun: true,
      },
    },
  ],
} as const satisfies Advice;

/** How {@link ZitadelConfigNothingToDeployError} is refused. */
const NOTHING_TO_DEPLOY_ADVICE = {
  hint: "Add a schema, flow, policy or branding under .zitadel/, or run `zitadel setup` to scaffold one.",
} as const satisfies Advice;

/** How {@link ZitadelConfigPasswordPolicyInvalidError} is refused. */
const PASSWORD_POLICY_INVALID_ADVICE = {
  hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from an empty one.",
} as const satisfies Advice;

/** How {@link ZitadelConfigSignupPolicyInvalidError} is refused. */
const SIGNUP_POLICY_INVALID_ADVICE = {
  hint: "Setup keeps an existing policy file and deploys it, so fix it against .zitadel/meta/policy.json or move it aside to start from the default.",
} as const satisfies Advice;

/** How {@link ZitadelConfigRenameActionClashError} is refused. */
const RENAME_ACTION_CLASH_ADVICE = {
  hint: 'Rename the action "{action}" on step "{step}" (and its transition), then run auth-method sso enable again.',
} as const satisfies Advice;

/** How {@link ZitadelConfigRenameRouteLossError} is refused. */
const RENAME_ROUTE_LOSS_ADVICE = {
  hint: 'Remove purpose and action from the transition "{transition}" on step "{step}", then run auth-method sso enable again.',
} as const satisfies Advice;

/** How {@link ZitadelConfigOutcomeActionClashError} is refused. */
const OUTCOME_ACTION_CLASH_ADVICE = {
  hint: 'Rename the action "{action}" on step "{step}" (and its transition), then run auth-method sso enable again.',
} as const satisfies Advice;

/**
 * What a step that uses a method holds once the method is gone: the part of
 * the step a person removes from it.
 */
const REMOVED_PART = {
  password: `${PASSWORD_FIELD} field`,
  passkey: "passkey actions and their transitions",
} as const satisfies Record<ToggleableMethod, string>;

/**
 * What to do about a step left with no field or sign-in method, as the hint
 * of {@link FLOW_METHOD_IN_USE_ADVICE} says it.
 *
 * @param uses - The steps that still use the method.
 * @returns The sentence, led by a space, or an empty string when no step is
 *   left with nothing.
 */
function deletionOf(uses: readonly FlowMethodUse[]): string {
  const emptied = uses.filter((use) => {
    return use.keeps.length === 0;
  });
  if (emptied.length === 0) {
    return "";
  }
  const incoming = emptied.flatMap((use) => {
    return use.staying;
  });
  const viaPurpose = incoming.some((item) => {
    return item.purpose !== undefined;
  });
  const retarget = viaPurpose
    ? "retarget the transitions listed for it (one marked via purposes.<key> follows that key instead)"
    : "retarget the transitions listed for it";
  const isEntry = emptied.some((use) => {
    return use.entryFor.length > 0;
  });
  const fixes = [
    ...(incoming.length > 0 ? [retarget] : []),
    ...(isEntry ? ["point the purposes key it is the entry step of at another step"] : []),
  ];
  if (fixes.length === 0) {
    return " Delete a step left with no field or sign-in method.";
  }
  return ` Delete a step left with no field or sign-in method: ${fixes.join(", and ")}.`;
}

/**
 * How the errors of `@/lib/zitadel` are advised on, each for exactly its class:
 * only those whose advice names a command or a flag.
 */
export const ZITADEL_WORDINGS: readonly Wording[] = [
  derived(ZitadelConfigFlowMethodInUseError, FLOW_METHOD_IN_USE_ADVICE, (error) => {
    return {
      values: {
        removed: REMOVED_PART[error.method],
        deletion: deletionOf(error.uses),
      },
    };
  }),
  [ZitadelConfigFlowUncheckedError, FLOW_UNCHECKED_ADVICE],
  [ZitadelConfigNothingToDeployError, NOTHING_TO_DEPLOY_ADVICE],
  [ZitadelConfigPasswordPolicyInvalidError, PASSWORD_POLICY_INVALID_ADVICE],
  [ZitadelConfigSignupPolicyInvalidError, SIGNUP_POLICY_INVALID_ADVICE],
  [ZitadelConfigRenameActionClashError, RENAME_ACTION_CLASH_ADVICE],
  [ZitadelConfigRenameRouteLossError, RENAME_ROUTE_LOSS_ADVICE],
  [ZitadelConfigOutcomeActionClashError, OUTCOME_ACTION_CLASH_ADVICE],
];

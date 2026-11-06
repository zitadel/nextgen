import { api } from "@/api/zitadel";
import { livePrimaryReleaseId } from "@/features/deployments/deployment";

import type { PasswordPolicyConfig } from "./password-policy";

/** The operation the password policy governs, which is the handle a release pins it under. */
const PASSWORD_SET = "auth.factor.password.set";

/**
 * The password policy the project enforces: the revision the release on its
 * primary origins pins, which `setUserPassword` from the console and a sign-in
 * there apply (root ADR 085). A revision published since serves nothing until
 * a release that pins it is deployed, so the newest one is not read.
 *
 * `undefined` when nothing is deployed to a primary origin; `config` is
 * `undefined` when that release pins no password policy, which enforces none.
 */
export async function readDeployedPasswordPolicy(
  projectId: string,
): Promise<{ config: PasswordPolicyConfig | undefined } | undefined> {
  const releaseId = await livePrimaryReleaseId(projectId);
  if (releaseId === undefined) {
    return undefined;
  }
  const release = await api.getReleaseById(releaseId, { project_id: projectId });
  const pointer = release.pointers.find(
    (candidate) => candidate.kind === "policy" && candidate.handle === PASSWORD_SET,
  );
  if (pointer === undefined) {
    return { config: undefined };
  }
  const revision = await api.getPolicyRevision(pointer.revision_id, { project_id: projectId });
  // The release pins it under the password operation, so another operation's
  // revision is a server fault, not a project without a password policy.
  if (revision.operation !== PASSWORD_SET) {
    throw new Error(`the release pins a ${revision.operation} revision as the password policy`);
  }
  return { config: revision.config };
}

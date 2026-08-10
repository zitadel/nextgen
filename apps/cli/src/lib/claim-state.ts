import { serverKind } from "./oclif/server-kind";
import type { ZitadelSecret } from "./project";
import { publicCliCommand } from "./public-cli";

/**
 * Whether this project is attached to a team, as the CLI can tell locally.
 *
 * `not-applicable` is its own variant rather than a boolean flag on the caller
 * because "there is nothing to attach here" and "nothing is attached yet" want
 * opposite output: the first prints nothing at all, the second nudges.
 */
export type ClaimState =
  | { kind: "attached"; team_id: string; claimed_at: string }
  | { kind: "detached" }
  | { kind: "not-applicable" };

/**
 * Whether the local record says a team owns this project.
 *
 * Both fields or neither: a half-written record is not an attachment, and
 * treating it as one would hand callers a `team_id` with no idea when it
 * landed. Shared with `zitadel claim`, which asks the same question before it
 * decides to skip, so the two cannot drift as the record grows fields.
 *
 * Deliberately separate from {@link claimState}: the command must answer this
 * on any server, while the nudges only ask it on the cloud.
 */
export function isAttached(
  secret: Pick<ZitadelSecret, "claimed_at" | "team_id">,
): secret is { claimed_at: string; team_id: string } {
  return Boolean(secret.claimed_at && secret.team_id);
}

/**
 * Decides the attachment state from local state alone.
 *
 * **Why no network call.** The contract exposes no ambient claim-state read:
 * `getClaimStatus` answers for one live challenge and rejects a secret that did
 * not mint it, and claim attributes were deliberately kept off
 * `GET /projects/{id}` because they belong to the grant, not the project. So
 * `.zitadel/secret` is the only source, which is also why `status` and `doctor`
 * stay fast and work offline. `zitadel claim` reaches the same conclusion the
 * same way before it decides to skip.
 *
 * **Why cloud only.** Claiming attaches a project to a team on the platform.
 * A local or self-hosted server has no such platform, and `--server local` is
 * the documented dev loop, so an ungated nudge would advertise an impossible
 * action for the entire life of a local project.
 *
 * The local record can be stale in one direction: a project claimed from
 * another machine, or a `.zitadel/secret` restored from a backup, reads as
 * `detached` here. That is tolerable because everything downstream is
 * advisory, and `zitadel claim` itself turns the resulting `409` into a clean
 * skip rather than an error.
 */
export function claimState(input: {
  secret: Pick<ZitadelSecret, "claimed_at" | "team_id">;
  server: string;
}): ClaimState {
  if (serverKind.value(input.server) !== "cloud") {
    return { kind: "not-applicable" };
  }
  if (isAttached(input.secret)) {
    return {
      kind: "attached",
      team_id: input.secret.team_id,
      claimed_at: input.secret.claimed_at,
    };
  }
  return { kind: "detached" };
}

/**
 * The nudge for `next_actions`, quoting the command the way `journey-guidance`
 * does.
 *
 * Deliberately says nothing about deletion: unattached projects are framed as
 * temporary, but the epic's 14-day lifetime is not enforced anywhere yet, so
 * promising it would be a lie the product cannot keep.
 */
export function claimAction(cliVersion: string): string {
  return (
    "This project is temporary until you attach it to a team: run " +
    `${publicCliCommand("claim", cliVersion)} to make it permanent. ` +
    "Nothing about the project changes, so users, passkeys, and the issuer keep working."
  );
}

/** The command for `next_commands`. */
export function claimCommand(cliVersion: string): string {
  return publicCliCommand("claim", cliVersion);
}

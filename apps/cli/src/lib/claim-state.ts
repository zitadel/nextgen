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
  const { claimed_at, team_id } = input.secret;
  if (claimed_at && team_id) {
    return { kind: "attached", team_id, claimed_at };
  }
  return { kind: "detached" };
}

/**
 * The one-line fact for a summary row or a status field.
 *
 * Kept here next to {@link claimState} rather than in `journey-guidance` (which
 * holds copy only) so a new variant cannot be added without the wording for it.
 * Deliberately says nothing about deletion: unattached projects are framed as
 * temporary, but the epic's 14-day lifetime is not enforced anywhere yet, so
 * promising it would be a lie the product cannot keep.
 */
export function claimSummary(state: ClaimState): string | undefined {
  switch (state.kind) {
    case "attached":
      return `attached to team ${state.team_id}`;
    case "detached":
      return "temporary until you attach it to a team";
    case "not-applicable":
      return undefined;
  }
}

/** The nudge for `next_actions`, quoting the command the way `journey-guidance` does. */
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

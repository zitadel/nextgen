import type { BoxAction } from "./box";
import { serverKind } from "./oclif/server-kind";
import type { ZitadelSecret } from "./project";
import { publicCliCommand } from "./public-cli";

/**
 * Mirrors domain.ClaimWindow (internal/domain/claim.go): the server refuses
 * `claim/init` and `claim/complete` with `proj.claim_window_expired` once the
 * project is more than this many days old. Keep the two in sync — drift here
 * shows as a wrong printed deadline, the enforcement stays server-side.
 */
export const CLAIM_WINDOW_DAYS = 14;

/**
 * The date after which the platform refuses to claim, from the project's
 * creation time. Falls back to `now` when creation time is unknown, which is
 * exact at setup time (the project was just created) and the only caller
 * without a recorded creation time.
 */
export function claimWindowDeadline(createdAt: string | undefined, now = Date.now()): Date {
  const base = createdAt === undefined ? now : Date.parse(createdAt);
  return new Date((Number.isNaN(base) ? now : base) + CLAIM_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

function deadlinePhrase(deadline?: Date): string {
  const when =
    deadline === undefined
      ? `within ${CLAIM_WINDOW_DAYS} days of creation`
      : `before ${deadline.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}`;
  return `attach it ${when}, after that it can no longer be claimed`;
}

/**
 * Whether this project is attached to a team, as the CLI can tell locally.
 *
 * `not-applicable` is its own variant rather than a boolean flag on the caller
 * because "there is nothing to attach here" and "nothing is attached yet" want
 * opposite output: the first prints nothing at all, the second nudges.
 */
export type ClaimState =
  | { kind: "attached"; team_id: string; claimed_at: string }
  /**
   * `claimable` classifies the claim window from the locally recorded
   * creation time: once it has passed, the server refuses the claim, so
   * nudges must stop advertising `zitadel claim`. Lenient on an unknown or
   * unparsable creation time (claimable, no deadline) because the server is
   * the enforcer and the CLI only advises. `deadline` is the ISO date the
   * window closes, when the creation time is known.
   */
  | { kind: "detached"; claimable: boolean; deadline?: string }
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
 * **Why cloud and local, but not self-hosted.** Claiming attaches a project
 * to a team on the platform that hosts it. The cloud has one, and so does a
 * CLI-launched local server: it hosts its own platform project and claim page
 * and advertises its own claim URL, so the local dev loop is a real claim
 * journey. A self-hosted server may or may not have a platform project, and
 * the CLI cannot tell from here, so nudging there could advertise an
 * impossible action for the entire life of the project.
 *
 * The local record can be stale in one direction: a project claimed from
 * another machine, or a `.zitadel/secret` restored from a backup, reads as
 * `detached` here. That is tolerable because everything downstream is
 * advisory, and `zitadel claim` itself turns the resulting `409` into a clean
 * skip rather than an error.
 */
export function claimState(input: {
  secret: Pick<ZitadelSecret, "claimed_at" | "team_id"> & { created_at?: string };
  server: string;
}): ClaimState {
  const kind = serverKind.value(input.server);
  if (kind !== "cloud" && kind !== "local") {
    return { kind: "not-applicable" };
  }
  if (isAttached(input.secret)) {
    return {
      kind: "attached",
      team_id: input.secret.team_id,
      claimed_at: input.secret.claimed_at,
    };
  }
  const createdAt = Date.parse(input.secret.created_at ?? "");
  if (Number.isNaN(createdAt)) {
    return { kind: "detached", claimable: true };
  }
  const deadline = claimWindowDeadline(input.secret.created_at);
  return {
    kind: "detached",
    claimable: deadline.getTime() > Date.now(),
    deadline: deadline.toISOString(),
  };
}

/**
 * The nudge for `next_actions`, quoting the command the way `journey-guidance`
 * does.
 *
 * Names the claim window because the server now enforces it at claim time
 * (`proj.claim_window_expired`); before that enforcement existed this copy
 * deliberately promised nothing. It still says nothing about deletion, because
 * nothing deletes the project when the window closes — it only stops being
 * claimable (ADR 046 §Non-goals).
 */
export function claimAction(cliVersion: string, deadline?: Date): string {
  return (
    `This project is temporary until you attach it to a team: ${deadlinePhrase(deadline)}. ` +
    `Run ${publicCliCommand("claim", cliVersion)} to make it permanent. ` +
    "Nothing about the project changes, so users, passkeys, and the issuer keep working."
  );
}

/**
 * The same nudge for the human box, with the command on its own styled line.
 */
export function claimBoxAction(cliVersion: string, deadline?: Date): BoxAction {
  return {
    text:
      `This project is temporary until you attach it to a team: ${deadlinePhrase(deadline)}. ` +
      "Claiming is independent of the steps above, so you can do it right away; " +
      "nothing about the project changes, and users, passkeys, and the issuer keep working:",
    command: publicCliCommand("claim", cliVersion),
  };
}

/** The command for `next_commands`. */
export function claimCommand(cliVersion: string): string {
  return publicCliCommand("claim", cliVersion);
}

/**
 * The nudge's counterpart for a closed claim window: the server refuses the
 * claim now, so this deliberately quotes no claim command anywhere; callers
 * must also keep `zitadel claim` out of `next_commands` alongside it.
 */
export function claimWindowClosedAction(cliVersion: string): string {
  return (
    `This project was not attached to a team within ${CLAIM_WINDOW_DAYS} days ` +
    "of creation, so it can no longer be claimed. It keeps working as it is; " +
    `to get a project you can attach, run ${publicCliCommand("setup", cliVersion)} ` +
    "in a fresh directory (in this one it would just skip as already initialized)."
  );
}

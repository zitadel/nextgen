import type { ProjectSecretData } from "@/lib/project";
import type { SuggestedCommand } from "@/lib/suggestion";
import type { BoxAction } from "@/lib/ui";

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
   * creation time: once it has passed, nudges switch to reconciliation
   * wording (Claim.windowClosedNudge). Never proof of anything: the local
   * record can be stale (a project claimed from another machine still reads
   * detached), so the claim command stays advertised as the safe check —
   * the server resolves the grant before the window. Lenient on an unknown
   * or unparsable creation time (claimable, no deadline) because the server
   * is the enforcer and the CLI only advises. `deadline` is the ISO date
   * the window closes, when the creation time is known.
   */
  | { kind: "detached"; claimable: boolean; deadline?: string }
  | { kind: "not-applicable" };

/** The fields of the local secret a claim is read from. */
type ClaimRecord = Pick<ProjectSecretData, "claimed_at" | "team_id"> & { created_at?: string };

/** What {@link Claim.of} reads a claim from. */
type ClaimInput = Readonly<{
  /** The project's local secret, or the part of it that exists. */
  secret: ClaimRecord;
  /** Whether the server the project lives on is the Zitadel cloud. */
  cloud: boolean;
}>;

/**
 * The claim of a project to a team: whether the local record says it is
 * attached, the window in which it can still be claimed, and the words every
 * command uses to nudge the person toward it.
 */
export class Claim {
  /**
   * Where a new project goes when this one can no longer be claimed: a
   * directory the reader names, never the run's own, where setup would skip as
   * already initialized.
   */
  static readonly FRESH_DIRECTORY = "<new-directory>";

  /**
   * Mirrors domain.ClaimWindow (internal/domain/claim.go): the server refuses
   * `claim/init` and `claim/complete` with `proj.claim_window_expired` once
   * the project is more than this many days old. Keep the two in sync: drift
   * here shows as a wrong printed deadline, the enforcement stays
   * server-side.
   */
  static readonly WINDOW_DAYS = 14;

  /** The window in milliseconds. */
  private static readonly WINDOW_MS = Claim.WINDOW_DAYS * 24 * 60 * 60 * 1000;

  /**
   * Decides the attachment state of a project from the local record alone.
   *
   * @param input - The project's secret, and whether it lives on the cloud.
   * @returns The state.
   */
  static state(input: ClaimInput): ClaimState {
    return Claim.classify(input);
  }

  /**
   * Whether the local record says a team owns this project.
   *
   * Both fields or neither: a half-written record is not an attachment, and
   * treating it as one would hand callers a `team_id` with no idea when it
   * landed. Shared with `zitadel claim`, which asks the same question before it
   * decides to skip, so the two cannot drift as the record grows fields.
   *
   * Deliberately separate from {@link Claim.state}: the command must answer this
   * on any server, while the nudges only ask it on the cloud.
   *
   * @param secret - The record, or the part of it that exists.
   * @returns Whether both fields are present.
   */
  static isAttached(
    secret: Pick<ProjectSecretData, "claimed_at" | "team_id">,
  ): secret is { claimed_at: string; team_id: string } {
    return Boolean(secret.claimed_at && secret.team_id);
  }

  /**
   * The date after which the platform refuses to claim, from the project's
   * creation time. Falls back to `now` when creation time is unknown, which is
   * exact at setup time (the project was just created) and the only caller
   * without a recorded creation time.
   *
   * @param createdAt - The project's recorded creation time, when known.
   * @param now - The stand-in for an unknown or unparsable creation time.
   * @returns The deadline.
   */
  static deadline(createdAt: string | undefined, now = Date.now()): Date {
    const base = createdAt === undefined ? now : Date.parse(createdAt);
    return new Date((Number.isNaN(base) ? now : base) + Claim.WINDOW_MS);
  }

  /**
   * The one claim nudge for `next_actions`, shared by `setup` and `status`
   * (doctor mirrors it with plain `zitadel` command names), quoting the
   * command in prose. The running command renders the command, so it carries
   * the run's own scope and targets the project this run is about rather than
   * whatever the next shell's environment resolves to.
   *
   * @param claim - The `claim` command, rendered by the run that reports it.
   * @param deadline - When the claim window closes, if it is known.
   * @returns The nudge.
   */
  static nudge(claim: SuggestedCommand, deadline: Date | undefined): string {
    return `${Claim.sentence(deadline)} Run ${claim}.`;
  }

  /**
   * The same nudge for the human box, with the command on its own styled line.
   *
   * @param claim - The `claim` command, rendered by the run that reports it.
   * @param deadline - When the claim window closes, if it is known.
   * @returns The box action.
   */
  static boxNudge(claim: SuggestedCommand, deadline: Date | undefined): BoxAction {
    return {
      text: Claim.sentence(deadline),
      command: claim,
    };
  }

  /**
   * The nudge's counterpart for a closed claim window. Deliberately framed as
   * reconciliation, not a verdict: the local record can be stale in one
   * direction (a project claimed from another machine still reads detached
   * here), so "window closed" from local data alone must not send the user off
   * to duplicate a project that is already attached and working. Running
   * `zitadel claim` is safe either way: the server checks the grant before
   * the window, so an attached project answers with a clean already-claimed
   * skip, and only a genuinely unattached one gets the final refusal.
   *
   * @param claim - The `claim` command, rendered by the run that reports it.
   * @param setup - The `setup` command aimed at {@link Claim.FRESH_DIRECTORY}.
   * @returns The nudge.
   */
  static windowClosedNudge(claim: SuggestedCommand, setup: SuggestedCommand): string {
    return (
      `The local record says this project's ${Claim.WINDOW_DAYS}-day claim window has ` +
      `closed. Run ${claim} to reconcile: a project ` +
      "claimed from another machine confirms its team, and one never claimed can no " +
      `longer be claimed. ${setup} in a fresh directory ` +
      "gets you a new project you can claim."
    );
  }

  /**
   * Time and zone included, not just the date: the server closes the window
   * at an exact timestamp (created_at + 14 x 24h), and a bare "before Sep 18"
   * misleads in both directions at the boundary day.
   *
   * @param deadline - When the window closes.
   * @returns The deadline as the person's locale prints it.
   */
  private static formatDeadline(deadline: Date): string {
    return deadline.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  }

  /**
   * The one claim sentence. Names the claim window because the server enforces
   * it at claim time (`proj.claim_window_expired`), and names the data-loss
   * stake per product decision: temporary projects get purged after the
   * window.
   *
   * @param deadline - When the claim window closes, if it is known.
   * @returns The sentence.
   */
  private static sentence(deadline?: Date): string {
    const when =
      deadline === undefined
        ? `within ${Claim.WINDOW_DAYS} days of creation`
        : `before ${Claim.formatDeadline(deadline)}`;
    return `Claim your project ${when} to make it permanent and start collaborating with your team. Until then, your project is temporary and its data may be lost.`;
  }

  /**
   * Decides the attachment state from local state alone.
   *
   * **Why no network call.** The contract exposes no ambient claim-state read:
   * `getProjectClaimStatus` answers for one live challenge and rejects a secret that did
   * not mint it, and claim attributes were deliberately kept off
   * `GET /projects/{id}` because they belong to the grant, not the project. So
   * `.zitadel/secret` is the only source, which is also why `status` and `doctor`
   * stay fast and work offline. `zitadel claim` reaches the same conclusion the
   * same way before it decides to skip.
   *
   * **Why cloud only.** Claiming attaches a project to a team on the platform
   * that hosts it. The cloud always has one. A local or self-hosted server has
   * one only when it opted into `platform.bootstrap_project`. `zitadel start`
   * does opt in, but a server started any other way — or one that opted out with
   * `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=false` — has no platform project, so this
   * offline classifier cannot know whether a local claim could complete. `setup` is online anyway and probes the local server's runtime
   * document to decide the nudge there; the offline surfaces (`status`,
   * `doctor`) stay cloud-gated rather than advertise a possibly impossible
   * action.
   *
   * The local record can be stale in one direction: a project claimed from
   * another machine, or a `.zitadel/secret` restored from a backup, reads as
   * `detached` here. That is tolerable because everything downstream is
   * advisory, and `zitadel claim` itself turns the resulting `409` into a clean
   * skip rather than an error.
   *
   * @param input - The project's secret, and whether it lives on the cloud.
   * @returns The state.
   */
  private static classify(input: ClaimInput): ClaimState {
    if (!input.cloud) {
      return { kind: "not-applicable" };
    }
    if (Claim.isAttached(input.secret)) {
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
    const deadline = Claim.deadline(input.secret.created_at);
    return {
      kind: "detached",
      claimable: deadline.getTime() > Date.now(),
      deadline: deadline.toISOString(),
    };
  }
}

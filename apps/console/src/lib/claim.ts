import { ApiError } from "@zitadel/api/runtime/fetch";

import { api } from "../api/zitadel";
import { describeError } from "./api-error";

/**
 * What one completion attempt came to. A discriminated union rather than a
 * thrown error because every branch is a screen state the claim page renders,
 * not an exception: the contract enumerates them (`claim/complete` in
 * `api/openapi/endpoints/projects/by_id/claim/complete/methods.yaml`).
 */
export type ClaimOutcome =
  | { kind: "claimed"; teamId: string; claimedAt: string }
  /** 409 — single-use, first-claim-wins; `details` names the owning team. */
  | { kind: "already_claimed"; message: string; teamId?: string; dashboardUrl?: string }
  /** 410 — the challenge aged out; only `claim/init` (the CLI) can mint a new one. */
  | { kind: "expired"; message: string }
  /**
   * 403 `claim.no_personal_team` — no membership at all. The contract is
   * explicit that this one clears itself: the next sign-in provisions the team
   * (the exchange-time ensure), so the page may honestly offer a retry.
   */
  | { kind: "no_personal_team"; message: string }
  /**
   * 403 `claim.personal_team_not_active` — the membership exists but is not
   * active, and the contract is equally explicit that provisioning will *not*
   * clear it. `membershipStatus` (`removed` | `inactive` | `pending`) is the
   * only thing that says who has to do what; it rides an otherwise untyped
   * details object, so it is read defensively and may be absent.
   */
  | { kind: "personal_team_not_active"; message: string; membershipStatus?: string }
  /** 400/404 — the challenge id is malformed or unknown. */
  | { kind: "invalid_challenge"; message: string }
  /**
   * 401 — the cookie is gone, **or** the session does not belong to the
   * platform project. The server deliberately collapses both into the public
   * `auth.unauthorized` verdict (`verifyClaimSession`, ADR 046 §2), so the
   * browser cannot tell them apart — which is why the page must not answer
   * this by silently re-running sign-in: on a deployment without a platform
   * project (`platform.bootstrap_project` off — the local testkit today),
   * every completion 401s and re-signing-in just loops.
   */
  | { kind: "unauthenticated" }
  /** 429, 5xx, network — nothing the page can name; retryable. */
  | { kind: "error"; message: string };

/**
 * Spend a claim challenge: `POST /projects/{project_id}/claim/complete`,
 * authenticated by the `__nextgen_session` cookie.
 *
 * Deliberately the **single** place the completion request is made (#615):
 * when ADR 053 adds the `X-Zitadel-CSRF` requirement it lands in this call
 * alone, and if ADR 054 grows the contract a team-selection parameter, the
 * body grows here. Callers render the outcome; they do not build the request.
 */
export async function completeProjectClaim(
  projectId: string,
  challengeId: string,
): Promise<ClaimOutcome> {
  try {
    const result = await api.completeClaim(
      projectId,
      { challenge_id: challengeId },
      // Same-origin by design (Console ADR 0002), but say `include` like the
      // session helpers do rather than leaning on the browser default.
      { credentials: "include" },
    );
    return { kind: "claimed", teamId: result.team_id, claimedAt: result.claimed_at };
  } catch (cause) {
    if (cause instanceof ApiError) {
      // ADR 030: the API owns the human-facing copy; render it verbatim.
      const message = describeError(cause, "The claim could not be completed.");
      switch (cause.status) {
        case 401:
          return { kind: "unauthenticated" };
        case 403:
          return personalTeamOutcome(message, cause.body);
        case 400:
        case 404:
          return { kind: "invalid_challenge", message };
        case 409:
          return { kind: "already_claimed", message, ...alreadyClaimedDetails(cause.body) };
        case 410:
          return { kind: "expired", message };
        default:
          return { kind: "error", message };
      }
    }
    return { kind: "error", message: describeError(cause, "The claim could not be completed.") };
  }
}

/**
 * The 409 body's `details` block (`already-claimed-response.yaml`): the owning
 * team and its dashboard. Read defensively — the base error schema does not
 * require it, and a missing block costs the link, not the screen.
 */
function alreadyClaimedDetails(body: unknown): { teamId?: string; dashboardUrl?: string } {
  if (!body || typeof body !== "object") return {};
  const details = (body as Record<string, unknown>).details;
  if (!details || typeof details !== "object") return {};
  const record = details as Record<string, unknown>;
  return {
    teamId: typeof record.team_id === "string" ? record.team_id : undefined,
    dashboardUrl: typeof record.dashboard_url === "string" ? record.dashboard_url : undefined,
  };
}

/**
 * Splits the 403's two codes (`completeClaim` declares them as a `oneOf`).
 * They differ in the only thing the developer cares about: whether signing in
 * again fixes it.
 *
 * An unrecognised code degrades to the recoverable branch rather than the dead
 * end — the server never said this account is permanently stuck, and offering a
 * retry that fails is kinder than refusing one that would have worked.
 */
function personalTeamOutcome(message: string, body: unknown): ClaimOutcome {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (record.code === "claim.personal_team_not_active") {
    return {
      kind: "personal_team_not_active",
      message,
      membershipStatus: membershipStatus(record),
    };
  }
  return { kind: "no_personal_team", message };
}

/**
 * `details.membership_status` from the not-active 403. The details object is
 * documented but untyped, so read it the same way `alreadyClaimedDetails` reads
 * its block: a missing value costs the remedy sentence, not the screen.
 */
function membershipStatus(body: Record<string, unknown>): string | undefined {
  const details = body.details;
  if (!details || typeof details !== "object") return undefined;
  const value = (details as Record<string, unknown>).membership_status;
  return typeof value === "string" ? value : undefined;
}

/**
 * The project's claim window: how long is left before an unclaimed project
 * can no longer be claimed at all (ADR 046's 14 days from creation), as
 * distinct from the claim *link*, which lapses in minutes.
 *
 * `expired` is the server's verdict rather than a comparison done here: a
 * browser clock hours out of step would otherwise contradict what the claim
 * legs enforce.
 */
export interface ClaimWindow {
  expiresAt: Date;
  expired: boolean;
}

/**
 * Read the claim window for the countdown on the claim page.
 *
 * Unauthenticated and idempotent, so it runs before the developer signs in
 * and survives reloads. It is decoration around the claim, never a gate:
 * every failure resolves to `undefined` and the page simply renders without a
 * countdown, because a claim that would have worked must not be blocked by a
 * read that did not.
 */
export async function fetchClaimWindow(
  projectId: string,
  challengeId: string,
): Promise<ClaimWindow | undefined> {
  try {
    const result = await api.getClaimWindow(projectId, { challenge_id: challengeId });
    const expiresAt = new Date(result.expires_at);
    if (Number.isNaN(expiresAt.getTime())) return undefined;
    return { expiresAt, expired: result.expired };
  } catch {
    return undefined;
  }
}

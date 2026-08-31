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
  /** 403 — the session user has no active personal team to attach the project to. */
  | { kind: "no_personal_team"; message: string }
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
          return { kind: "no_personal_team", message };
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

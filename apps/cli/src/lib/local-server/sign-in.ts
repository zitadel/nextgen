import { createZitadelClient } from "@zitadel/api/client";
import type { VerifyChallengeProofBody } from "@zitadel/api/generated/model";
import { ApiError } from "@zitadel/api/runtime/fetch";

import { ZitadelError } from "../errors";
import { isObject } from "../json";
import type { LocalAdmin } from "./admin-credential";
import { PLATFORM_PROJECT_ID, readPlatformRuntime } from "./runtime";

/**
 * Signing the local admin in without a browser.
 *
 * The auth-attempt API is the state machine the login widget drives; the widget
 * adds the rendering. With no page to render, the CLI states the factors
 * outright: open an attempt, prove the identifier, prove the password, take the
 * one-time `handoff_token`. That token becomes either a console sign-in link or,
 * exchanged, a session cookie.
 */

/**
 * Every call here runs after the server answered `/healthz`, so a stall means a
 * wedged server rather than a slow start. Without a bound, `zitadel start`
 * would hang on a socket that accepts and never answers.
 */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Per-call request options: the server's own origin, and a fresh timeout (the
 * bound starts when the signal is made, so it cannot be shared across calls).
 */
export function localAdminRequest(
  serverUrl: string,
  headers: Record<string, string> = {},
): RequestInit {
  return {
    headers: { origin: new URL(serverUrl).origin, ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
}

/** A console URL that signs the admin in once, via a fresh handoff token. */
export async function consoleSignInUrl(serverUrl: string, admin: LocalAdmin): Promise<string> {
  const { handoffToken } = await signIn(serverUrl, admin);
  return `${serverUrl}/ui/console/login?handoff=${encodeURIComponent(handoffToken)}`;
}

/**
 * Signs in and trades the handoff token for the `__nextgen_session` cookie —
 * the credential endpoints like `claim/complete` authenticate against, which a
 * bare handoff token cannot satisfy.
 */
export async function adminSessionCookie(serverUrl: string, admin: LocalAdmin): Promise<string> {
  const { handoffToken, publishableKey } = await signIn(serverUrl, admin);

  // The one call made with fetch directly: the session comes back only as a
  // Set-Cookie header, which the generated client does not expose.
  const res = await fetch(
    `${serverUrl}/sessions/exchange?project_id=${encodeURIComponent(PLATFORM_PROJECT_ID)}`,
    {
      ...localAdminRequest(serverUrl, {
        "content-type": "application/json",
        authorization: `Bearer ${publishableKey}`,
      }),
      method: "POST",
      body: JSON.stringify({ handoff_token: handoffToken }),
    },
  );
  const cookie = res.headers
    .getSetCookie()
    .find((value) => value.startsWith("__nextgen_session="))
    ?.split(";", 1)[0];
  if (!res.ok || !cookie) {
    throw new ZitadelError(
      "E_AUTH",
      `Local admin session exchange failed (${String(res.status)})`,
      {
        details: { status: res.status },
      },
    );
  }
  return cookie;
}

/**
 * Proves the admin's identifier and password against a fresh auth attempt and
 * returns its terminal handoff token, without exchanging it.
 */
async function signIn(
  serverUrl: string,
  admin: LocalAdmin,
): Promise<{ handoffToken: string; publishableKey: string }> {
  const runtime = await readPlatformRuntime(serverUrl, REQUEST_TIMEOUT_MS);
  if (!runtime) {
    throw new ZitadelError(
      "E_VALIDATION",
      "The local server does not host the platform project, so the local admin cannot sign in",
      {
        // `zitadel start` adopts a healthy running server untouched, so it
        // cannot fix this on its own: the server has to stop first.
        hint: "Stop it with `zitadel stop`, then run `zitadel start` so it boots with the platform project and the local admin.",
        nextCommands: ["zitadel stop", "zitadel start"],
        details: { server_url: serverUrl },
      },
    );
  }
  const client = createZitadelClient({ baseUrl: serverUrl, token: runtime.publishable_key });

  const { attempt_id } = await client.createAuthAttempt(
    { project_id: PLATFORM_PROJECT_ID },
    localAdminRequest(serverUrl),
  );
  // Just the value: the server resolves it against the platform project's
  // designated identifier — the default user schema designates `email`, the
  // attribute the bootstrap document writes — rather than a property the
  // client names.
  await prove(client, serverUrl, attempt_id, "identifier", { login_name: admin.email });
  await prove(client, serverUrl, attempt_id, "password", { password: admin.password });

  const { handoff_token } = await client.createHandoff(attempt_id, localAdminRequest(serverUrl));
  return { handoffToken: handoff_token, publishableKey: runtime.publishable_key };
}

/**
 * Issues a challenge for one factor and answers it. The proof must carry the
 * challenge just issued: the server rejects a proof against a re-issued
 * challenge, so the two calls belong together.
 */
async function prove(
  client: ReturnType<typeof createZitadelClient>,
  serverUrl: string,
  attemptId: string,
  method: "identifier" | "password",
  proof: VerifyChallengeProofBody,
): Promise<void> {
  const { challenge_id } = await client.issueChallenge(
    attemptId,
    { method },
    localAdminRequest(serverUrl),
  );
  try {
    await client.verifyChallengeProof(attemptId, challenge_id, proof, localAdminRequest(serverUrl));
  } catch (error) {
    if (method === "identifier" && isProofRejected(error)) {
      throw adminNotFound();
    }
    throw error;
  }
}

function isProofRejected(error: unknown): boolean {
  return (
    error instanceof ApiError && isObject(error.body) && error.body.code === "att.proof_rejected"
  );
}

/**
 * A rejected identifier usually means this server never imported the admin — a
 * data directory from before the local admin existed. But the server reports a
 * failed lookup with the same code, so the message names both causes, and the
 * command it suggests is the harmless one: the reset that fixes the first cause
 * deletes local data, so it stays a hint a person reads, never a next command
 * an agent runs.
 */
function adminNotFound(): ZitadelError {
  return new ZitadelError("E_AUTH", "The local server could not find the local admin", {
    hint: "Check `zitadel logs` first: a server that failed the lookup reports it the same way. If the logs show no error, the local data directory predates the local admin — `zitadel reset --force` deletes the local data so `zitadel start` can import it again.",
    nextCommands: ["zitadel logs"],
  });
}

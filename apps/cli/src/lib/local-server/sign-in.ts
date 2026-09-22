import { ZitadelError } from "../errors";
import { isObject } from "../json";
import type { LocalAdmin } from "./admin-credential";
import { apiError, fetchJson, postJson, type JsonResponse } from "./http";
import { PLATFORM_PROJECT_ID } from "./platform";

/**
 * Signing the local admin in without a browser.
 *
 * The auth-attempt API is the state machine the login widget drives; the widget
 * adds the rendering. With no page to render, the CLI states the factors
 * outright: open an attempt, prove the identifier, prove the password, take the
 * one-time `handoff_token`. That token becomes either a console sign-in link or,
 * exchanged, a session cookie.
 */

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

  const res = await postJson(
    `${serverUrl}/sessions/exchange?project_id=${encodeURIComponent(PLATFORM_PROJECT_ID)}`,
    { handoff_token: handoffToken },
    { authorization: `Bearer ${publishableKey}`, origin: new URL(serverUrl).origin },
  );
  const cookie = res.cookies
    .find((value) => value.startsWith("__nextgen_session="))
    ?.split(";", 1)[0];
  if (!res.ok || !cookie) {
    throw apiError("sessions/exchange", res);
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
  const publishableKey = await platformPublishableKey(serverUrl);
  const attempts = attemptClient(serverUrl, publishableKey);

  const attempt = await attempts("/auth_attempts", { project_id: PLATFORM_PROJECT_ID });
  if (!isObject(attempt.body) || typeof attempt.body.attempt_id !== "string") {
    throw apiError("auth_attempts", attempt);
  }
  const attemptId = encodeURIComponent(attempt.body.attempt_id);

  // Just the value: the server resolves it against the platform project's
  // designated identifier — the default user schema designates `email`, the
  // attribute the bootstrap document writes — rather than a property the
  // client names (ADR 058 §5).
  await prove(attempts, attemptId, "identifier", { login_name: admin.email });
  await prove(attempts, attemptId, "password", { password: admin.password });

  const handoff = await attempts(`/auth_attempts/${attemptId}/handoff`, {});
  if (!isObject(handoff.body) || typeof handoff.body.handoff_token !== "string") {
    throw apiError("handoff", handoff);
  }
  return { handoffToken: handoff.body.handoff_token, publishableKey };
}

/**
 * Issues a challenge for one factor and answers it. The proof must carry the
 * challenge just issued: the server rejects a proof against a re-issued
 * challenge, so the two calls belong together.
 */
async function prove(
  attempts: AttemptClient,
  attemptId: string,
  method: "identifier" | "password",
  proof: Record<string, string>,
): Promise<void> {
  const challenge = await attempts(`/auth_attempts/${attemptId}/challenges`, { method });
  if (!isObject(challenge.body) || typeof challenge.body.challenge_id !== "string") {
    throw apiError(`${method} challenge`, challenge);
  }

  const challengeId = encodeURIComponent(challenge.body.challenge_id);
  const verified = await attempts(
    `/auth_attempts/${attemptId}/challenges/${challengeId}/verify`,
    proof,
  );
  if (!verified.ok) {
    throw proofError(method, verified);
  }
}

type AttemptClient = (path: string, body: Record<string, unknown>) => Promise<JsonResponse>;

/** Posts to the auth-attempt API with the browser-plane credential it expects. */
function attemptClient(serverUrl: string, publishableKey: string): AttemptClient {
  const origin = new URL(serverUrl).origin;
  return async (path, body) =>
    postJson(`${serverUrl}${path}`, body, {
      authorization: `Bearer ${publishableKey}`,
      origin,
    });
}

/**
 * A rejected identifier usually means this server never imported the admin — a
 * data directory from before the local admin existed. But the server reports a
 * failed lookup with the same code, so the message names both causes, and the
 * command it suggests is the harmless one: the reset that fixes the first cause
 * deletes local data, so it stays a hint a person reads, never a next command
 * an agent runs.
 */
function proofError(method: string, res: JsonResponse): ZitadelError {
  const code = isObject(res.body) && typeof res.body.code === "string" ? res.body.code : undefined;
  if (method === "identifier" && code === "att.proof_rejected") {
    return new ZitadelError("E_AUTH", "The local server could not find the local admin", {
      hint: "Check `zitadel logs` first: a server that failed the lookup reports it the same way. If the logs show no error, the local data directory predates the local admin — `zitadel reset --force` deletes the local data so `zitadel start` can import it again.",
      nextCommands: ["zitadel logs"],
    });
  }
  return apiError(`${method} proof`, res);
}

/**
 * The platform project's browser-safe key, which also authorises the
 * auth-attempt calls. Its absence means this server was not started with the
 * platform project, which no retry will change.
 */
async function platformPublishableKey(serverUrl: string): Promise<string> {
  const res = await fetchJson(`${serverUrl}/console/runtime.json`, { method: "GET" });
  const runtime = res.body;
  if (
    !res.ok ||
    !isObject(runtime) ||
    runtime.console_project_id !== PLATFORM_PROJECT_ID ||
    typeof runtime.publishable_key !== "string"
  ) {
    throw new ZitadelError(
      "E_VALIDATION",
      "The local server does not host the platform project, so the local admin cannot sign in",
      {
        // `zitadel start` adopts a healthy running server untouched, so it
        // cannot fix this on its own: the server has to stop first.
        hint: "Stop it with `zitadel stop`, then run `zitadel start` so it boots with the platform project and the local admin.",
        nextCommands: ["zitadel stop", "zitadel start"],
        details: {
          server_url: serverUrl,
          console_project_id: isObject(runtime) ? runtime.console_project_id : undefined,
        },
      },
    );
  }
  return runtime.publishable_key;
}

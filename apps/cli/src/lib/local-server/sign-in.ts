import { apiBaseUrl, request } from "@/lib/backend/transport";

import { createZitadelClient, AuthAttemptService } from "@/lib/backend";
import { ZitadelError } from "@/lib/errors";
import type { LocalAdmin } from "./admin-credential";
import { PLATFORM_PROJECT_ID, readPlatformRuntime } from "./runtime";
import { unscopedCommand } from "@/lib/suggestion";
import { userAgent } from "@/lib/user-agent";

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
 * Every call here runs after the server answered `/readyz`, so a stall means a
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
export async function consoleSignInUrl(
  serverUrl: string,
  admin: LocalAdmin,
  signal: AbortSignal,
): Promise<string> {
  const { handoffToken } = await signIn(serverUrl, admin, signal);
  return `${serverUrl}/ui/console/login?handoff=${encodeURIComponent(handoffToken)}`;
}

/** The names the server sets its session cookie under (ADR 083), over plain http to a loopback host and over https. */
const SESSION_COOKIES = ["zitadel_session", "__Host-zitadel_session"] as const;

/**
 * Signs in and trades the handoff token for the session cookie — the
 * credential endpoints like `claim/complete` authenticate against, which a bare
 * handoff token cannot satisfy. It is `zitadel_session` from a server on
 * loopback http and `__Host-zitadel_session` from one on https, and goes back
 * under the name it came with.
 */
export async function adminSessionCookie(
  serverUrl: string,
  admin: LocalAdmin,
  signal: AbortSignal,
): Promise<string> {
  const { handoffToken, publishableKey } = await signIn(serverUrl, admin, signal);

  // The one call made without the generated client: the session comes back
  // only as a Set-Cookie header, which that client does not expose. The
  // backend's own sender honours the signal and raises the same BackendError
  // the client would, so an unreachable server reads the same either way.
  const { res } = await request(
    `${apiBaseUrl(serverUrl)}/sessions/exchange?project_id=${encodeURIComponent(PLATFORM_PROJECT_ID)}`,
    {
      ...localAdminRequest(serverUrl, {
        "content-type": "application/json",
        authorization: `Bearer ${publishableKey}`,
      }),
      method: "POST",
      body: JSON.stringify({ handoff_token: handoffToken }),
    },
    { signal },
  );
  const cookie = res.headers
    .getSetCookie()
    .map((value) => {
      return value.split(";", 1)[0] ?? "";
    })
    .find((pair) => {
      return SESSION_COOKIES.some((name) => {
        return pair.startsWith(`${name}=`);
      });
    });
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
  signal: AbortSignal,
): Promise<{ handoffToken: string; publishableKey: string }> {
  const runtime = await readPlatformRuntime(serverUrl, REQUEST_TIMEOUT_MS);
  if (!runtime) {
    throw new ZitadelError(
      "E_VALIDATION",
      "The local server does not host the platform project, so the local admin cannot sign in",
      {
        // `zitadel start` adopts a healthy running server untouched, so it
        // cannot fix this on its own: the server has to stop first.
        hint: "Stop it, then start it again so it boots with the platform project and the local admin.",
        nextCommands: [unscopedCommand("stop"), unscopedCommand("start")],
        details: { server_url: serverUrl },
      },
    );
  }
  const client = createZitadelClient({
    userAgent: userAgent(),
    baseUrl: serverUrl,
    token: runtime.publishable_key,
    signal,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });

  const attempts = new AuthAttemptService(client, new URL(serverUrl).origin);
  const attemptId = await attempts.open(PLATFORM_PROJECT_ID);
  // Just the value: the server resolves it against the platform project's
  // designated identifier — the default user schema designates `email`, the
  // attribute the bootstrap document writes — rather than a property the
  // client names.
  const identifier = await attempts.prove(attemptId, "identifier", {
    login_name: admin.email,
  });
  switch (identifier.outcome) {
    case "rejected":
      throw adminNotFound();
    case "proved":
      break;
  }
  const password = await attempts.prove(attemptId, "password", {
    password: admin.password,
  });
  switch (password.outcome) {
    case "rejected":
      throw password.cause;
    case "proved":
      break;
  }
  const handoffToken = await attempts.handoff(attemptId);
  return {
    handoffToken,
    publishableKey: runtime.publishable_key,
  };
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
    nextCommands: [unscopedCommand("logs")],
  });
}

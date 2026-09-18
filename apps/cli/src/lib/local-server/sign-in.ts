import { ZitadelError } from "../errors";
import { isObject } from "../json";
import type { LocalAdmin } from "./admin-credential";
import { apiError, fetchJson, postJson, type JsonResponse } from "./http";
import { PLATFORM_PROJECT_ID } from "./platform";

/**
 * Signing the local admin in without a browser.
 *
 * There is no API that takes an email and a password and returns a session, so
 * the CLI drives the login flow the way the login widget does: ask the server
 * for the current step, fill in the fields it declares, submit, repeat, until
 * the flow ends with a one-time `handoff_token`. That token becomes either a
 * console sign-in link or, exchanged, a session cookie.
 *
 * This is the fragile part of the local admin: the CLI renders nothing, so it
 * infers from field names which box wants the password and which wants the
 * email. `POST /auth_attempts` is the API that would let it state both outright
 * — see #1256, which fixes the server-side gap that makes it unusable today.
 */

/** A step the flow API returned: either a form to fill, or the terminal token. */
type FlowStep = {
  id?: unknown;
  handoff_token?: unknown;
  step?: unknown;
};

/** Steps the login flow routes to when the identifier is unknown to the server. */
const REGISTRATION_STEPS = new Set(["register", "register-password"]);

/**
 * How many steps a password login may take before the CLI gives up. The shipped
 * flows take two (identifier, password); the bound exists so an unexpected flow
 * fails with a diagnosis instead of looping.
 */
const MAX_FLOW_STEPS = 6;

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
 * Walks the platform project's login flow to its terminal handoff token,
 * without exchanging it.
 */
async function signIn(
  serverUrl: string,
  admin: LocalAdmin,
): Promise<{ handoffToken: string; publishableKey: string }> {
  const publishableKey = await platformPublishableKey(serverUrl);
  const flow = flowClient(serverUrl, publishableKey);

  let step: FlowStep = await flow("/flow", {
    project_id: PLATFORM_PROJECT_ID,
    purpose: "login",
  });

  for (let hop = 0; hop < MAX_FLOW_STEPS; hop += 1) {
    if (typeof step.handoff_token === "string") {
      return { handoffToken: step.handoff_token, publishableKey };
    }

    const current = isObject(step.step) ? step.step : {};
    if (typeof current.name === "string" && REGISTRATION_STEPS.has(current.name)) {
      // The flow routes to registration only when the identifier is unknown,
      // so this server never imported the admin — an older data directory,
      // say. Refuse rather than sign a second user up.
      throw new ZitadelError("E_AUTH", `The local server has no user ${admin.email}`, {
        hint: "The local data directory predates the local admin. Run `zitadel reset --force`, then `zitadel start`.",
        nextCommands: ["zitadel reset --force", "zitadel start"],
      });
    }

    step = await flow(`/flow/${encodeURIComponent(String(step.id))}/submit`, {
      action: "submit",
      fields: answerStep(current, admin),
    });
  }

  throw new ZitadelError("E_AUTH", "The local admin login did not complete", {
    details: { last_step: isObject(step.step) ? step.step.name : undefined },
  });
}

/**
 * Fills the fields a step declares. Credential fields are named by schema
 * pointer (`x-auth-methods#password`), so the trailing segment is what says
 * whether a box wants the password; everything else on a login flow identifies
 * the user, which for this admin is their email.
 */
function answerStep(step: Record<string, unknown>, admin: LocalAdmin): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const field of Array.isArray(step.fields) ? step.fields : []) {
    if (!isObject(field) || typeof field.name !== "string") continue;
    const isPassword = field.name.split("#").pop() === "password";
    fields[field.name] = isPassword ? admin.password : admin.email;
  }
  return fields;
}

/**
 * Posts one flow call, carrying the sealed `_zflow` cookie forward. The flow is
 * stateless across calls: every response re-seals its state into `Set-Cookie`
 * and a submit without it is rejected. A browser round-trips it implicitly;
 * here the closure is the jar.
 */
function flowClient(serverUrl: string, publishableKey: string) {
  const origin = new URL(serverUrl).origin;
  let flowCookie: string | undefined;

  return async function flow(path: string, body: Record<string, unknown>): Promise<FlowStep> {
    const res = await postJson(`${serverUrl}${path}`, body, {
      authorization: `Bearer ${publishableKey}`,
      origin,
      ...(flowCookie ? { cookie: flowCookie } : {}),
    });

    for (const raw of res.cookies) {
      const [pair] = raw.split(";", 1);
      if (pair?.startsWith("_zflow=")) flowCookie = pair;
    }

    if (!res.ok || !isObject(res.body)) {
      throw flowError(path, res);
    }
    return res.body;
  };
}

/**
 * A rejected step comes back as 400 with a flow response, not an error body:
 * the reason sits in `step.error` (`internal/api/flow.go`), so read it there
 * before falling back to the generic shape.
 */
function flowError(path: string, res: JsonResponse): ZitadelError {
  const step = isObject(res.body) && isObject(res.body.step) ? res.body.step : undefined;
  const reason = step && typeof step.error === "string" ? step.error : undefined;
  if (reason === undefined) {
    return apiError(`flow ${path}`, res);
  }
  return new ZitadelError("E_AUTH", `The local admin could not sign in: ${reason}`, {
    details: { status: res.status, step: step?.name, error: reason },
  });
}

/**
 * The platform project's browser-safe key, which also authorises the flow
 * calls. Its absence means this server was not started with the platform
 * project, which no retry will change.
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

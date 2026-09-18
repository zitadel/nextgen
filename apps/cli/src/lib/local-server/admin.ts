import { pbkdf2Sync, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { defaultHumanUserSchemaUrl } from "@zitadel/config";

import { ZitadelError } from "../errors";
import { isObject } from "../json";
import { LOCAL_RUNTIME_DIR } from "./runtime";

/**
 * The local admin a CLI-managed server is started with, so a developer exists
 * on their own server without signing up and their local projects are owned
 * from the start.
 *
 * `zitadel start` writes two gitignored files under `.zitadel/local/`:
 *
 * - `admin.json`: the credential the CLI keeps (email, generated password, ids).
 * - `admin-user.json`: the server's bootstrap user document, handed to the
 *   binary as `--user-file`. It carries only a PBKDF2 hash of the password.
 *
 * The password is never printed. The CLI proves it against the auth-attempt
 * API — the state machine the login widget drives — and turns the resulting
 * one-time handoff token into a console sign-in link
 * (`/ui/console/login?handoff=…`).
 */
export const LOCAL_ADMIN_FILE = `${LOCAL_RUNTIME_DIR}/admin.json`;
export const LOCAL_ADMIN_USER_FILE = `${LOCAL_RUNTIME_DIR}/admin-user.json`;

const PLATFORM_PROJECT_ID = "proj_platform";
// The default user schema the platform project is seeded with, derived from
// the same default `schema.builtin_public_base` the server uses rather than
// spelled out here: a document naming a schema the server does not have is
// bootstrapped against an empty placeholder, and the admin then cannot sign in.
// CLI-managed servers do not override that base.
const DEFAULT_USER_SCHEMA_URL = defaultHumanUserSchemaUrl();
const ADMIN_USER_ID = "user_localadmin";
const ADMIN_TEAM_ID = "team_localadmin";
/** The local admin's sign-in identifier; the default user schema identifies users by email. */
export const LOCAL_ADMIN_EMAIL = "admin@zitadel.localhost";
/**
 * Which user attribute identifies the admin. A project decides this for itself,
 * and this one is the CLI's own: the bootstrap document below writes the email
 * under `email`, so that is what an identifier proof names.
 */
const ADMIN_IDENTIFIER_ATTRIBUTE = "email";
const PBKDF2_ROUNDS = 210_000;
/**
 * Every call here runs after the server answered `/healthz`, so a stalled
 * request means the server is wedged rather than still starting. Without a
 * bound, `zitadel start` would hang on a socket that never answers.
 */
const REQUEST_TIMEOUT_MS = 10_000;

export type LocalAdmin = {
  email: string;
  password: string;
  user_id: string;
  team_id: string;
};

/** Reads the local admin credential, or `undefined` when `start` never wrote one. */
export async function readLocalAdmin(cwd: string): Promise<LocalAdmin | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(cwd, LOCAL_ADMIN_FILE), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw malformedAdminFile(error);
  }
  if (
    !isObject(parsed) ||
    typeof parsed.email !== "string" ||
    typeof parsed.password !== "string" ||
    typeof parsed.user_id !== "string" ||
    typeof parsed.team_id !== "string"
  ) {
    throw malformedAdminFile();
  }
  return parsed as LocalAdmin;
}

function malformedAdminFile(cause?: unknown): ZitadelError {
  return new ZitadelError("E_VALIDATION", `${LOCAL_ADMIN_FILE} is malformed`, {
    hint: "Delete .zitadel/local/ and run `zitadel start` again.",
    ...(cause ? { details: { cause: cause instanceof Error ? cause.message : String(cause) } } : {}),
  });
}

/**
 * Creates the local admin on first use and (re)writes the server's bootstrap
 * user document. Returns the credential and the document path for
 * `--user-file`. The server imports the user only once; later starts skip it
 * because the user already exists, so the stored password stays valid.
 */
export async function ensureLocalAdmin(
  cwd: string,
): Promise<{ admin: LocalAdmin; userFile: string }> {
  await mkdir(join(cwd, LOCAL_RUNTIME_DIR), { recursive: true, mode: 0o700 });
  let admin = await readLocalAdmin(cwd);
  if (!admin) {
    const candidate: LocalAdmin = {
      // A fixed, clearly-local identity rather than anything inferred from
      // Git config, which can carry a stale, work, or noreply address.
      email: LOCAL_ADMIN_EMAIL,
      password: randomBytes(24).toString("base64url"),
      user_id: ADMIN_USER_ID,
      team_id: ADMIN_TEAM_ID,
    };
    // Exclusive create, so two concurrent `zitadel start` runs in one directory
    // cannot each mint a password and leave the bootstrap document holding the
    // hash of the one that lost. The loser reads the winner's credential.
    admin =
      (await writePrivateIfAbsent(
        join(cwd, LOCAL_ADMIN_FILE),
        `${JSON.stringify(candidate, null, 2)}\n`,
      ))
        ? candidate
        : ((await readLocalAdmin(cwd)) ?? candidate);
  }

  // Readable beyond the owner, unlike admin.json: the docker runtime mounts
  // this document into a container that runs as the host user only when the
  // CLI can map one (never as root, never without a uid), and an unreadable
  // file fails the server's bootstrap import at startup. It carries a PBKDF2
  // hash, never the password.
  const userFile = join(cwd, LOCAL_ADMIN_USER_FILE);
  await writeFile(userFile, `${JSON.stringify(bootstrapUserDocument(admin), null, 2)}\n`, {
    mode: 0o644,
  });
  await chmod(userFile, 0o644).catch(() => undefined);
  return { admin, userFile };
}

/** A console URL that signs the admin in once, via a fresh handoff token. */
export async function consoleSignInUrl(serverUrl: string, admin: LocalAdmin): Promise<string> {
  const { handoffToken } = await adminHandoff(serverUrl, admin);
  return `${serverUrl}/ui/console/login?handoff=${encodeURIComponent(handoffToken)}`;
}

/**
 * Attaches a freshly created project to the admin's team, through the same
 * claim endpoints `zitadel claim` and the console use: `claim/init` with the
 * project secret, `claim/complete` with the admin's session cookie.
 */
export async function claimProjectAsAdmin(input: {
  serverUrl: string;
  projectId: string;
  projectSecret: string;
  admin: LocalAdmin;
  // `claimed_at` is absent when the project was already claimed: the 409 body
  // names the owning team but not when it happened, and inventing a local
  // timestamp would disagree with the grant this record mirrors.
}): Promise<{ team_id: string; claimed_at?: string }> {
  const { serverUrl, projectId, projectSecret, admin } = input;
  const origin = new URL(serverUrl).origin;
  const project = encodeURIComponent(projectId);

  const init = await fetchJson(`${serverUrl}/projects/${project}/claim/init?project_id=${project}`, {
    method: "POST",
    headers: { authorization: `Bearer ${projectSecret}`, origin },
  });
  if (init.status === 409 && isObject(init.body) && isObject(init.body.details)) {
    const teamId = init.body.details.team_id;
    if (typeof teamId === "string") {
      return { team_id: teamId };
    }
  }
  if (!init.ok || !isObject(init.body) || typeof init.body.challenge_id !== "string") {
    throw apiError("claim/init", init);
  }

  const cookie = await adminSessionCookie(serverUrl, admin);
  const complete = await fetchJson(
    `${serverUrl}/projects/${project}/claim/complete?project_id=${project}`,
    {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin },
      body: JSON.stringify({ challenge_id: init.body.challenge_id }),
    },
  );
  if (
    !complete.ok ||
    !isObject(complete.body) ||
    typeof complete.body.team_id !== "string" ||
    typeof complete.body.claimed_at !== "string"
  ) {
    throw apiError("claim/complete", complete);
  }
  return { team_id: complete.body.team_id, claimed_at: complete.body.claimed_at };
}

function bootstrapUserDocument(admin: LocalAdmin) {
  return {
    header: {
      project_id: PLATFORM_PROJECT_ID,
      team_id: admin.team_id,
      schema_url: DEFAULT_USER_SCHEMA_URL,
      id: admin.user_id,
    },
    attributes: {
      username: admin.email,
      email: admin.email,
      "zitadel.source": "cli",
      "zitadel.default_user": true,
    },
    authenticators: {
      password: { encoded_hash: pbkdf2Hash(admin.password), change_required: false },
    },
  };
}

/** passlib-style `$pbkdf2-sha256$rounds$salt$hash`, which the server verifies. */
function pbkdf2Hash(password: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, PBKDF2_ROUNDS, 32, "sha256");
  return `$pbkdf2-sha256$${String(PBKDF2_ROUNDS)}$${ab64(salt)}$${ab64(hash)}`;
}

function ab64(bytes: Buffer): string {
  return bytes.toString("base64").replace(/=+$/, "").replaceAll("+", ".");
}

async function adminSessionCookie(serverUrl: string, admin: LocalAdmin): Promise<string> {
  const { handoffToken, projectId, publishableKey } = await adminHandoff(serverUrl, admin);
  const res = await bounded(
    `${serverUrl}/sessions/exchange?project_id=${encodeURIComponent(projectId)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${publishableKey}`,
        origin: new URL(serverUrl).origin,
      },
      body: JSON.stringify({ handoff_token: handoffToken }),
    },
  );
  const cookie = res.headers
    .getSetCookie()
    .find((value) => value.startsWith("__nextgen_session="))
    ?.split(";", 1)[0];
  if (!res.ok || !cookie) {
    throw apiError("sessions/exchange", { ok: res.ok, status: res.status, body: await safeJson(res) });
  }
  return cookie;
}

/**
 * Authenticates the admin through the auth-attempt API — the same state machine
 * the login widget drives, minus the rendered steps: issue a factor challenge,
 * prove it, hand off. The CLI wrote this user's attributes itself, so it names
 * the one that identifies them rather than reading it off a step.
 */
async function adminHandoff(
  serverUrl: string,
  admin: LocalAdmin,
): Promise<{ handoffToken: string; projectId: string; publishableKey: string }> {
  const publishableKey = await platformPublishableKey(serverUrl);
  const origin = new URL(serverUrl).origin;

  const post = async (path: string, body: Record<string, unknown>): Promise<JsonResponse> =>
    fetchJson(`${serverUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${publishableKey}`, origin },
      body: JSON.stringify(body),
    });

  const attempt = await post("/auth_attempts", { project_id: PLATFORM_PROJECT_ID });
  if (!attempt.ok || !isObject(attempt.body) || typeof attempt.body.attempt_id !== "string") {
    throw apiError("auth_attempts", attempt);
  }
  const attemptId = encodeURIComponent(attempt.body.attempt_id);

  const prove = async (method: string, proof: Record<string, unknown>): Promise<void> => {
    const challenge = await post(`/auth_attempts/${attemptId}/challenges`, { method });
    if (!challenge.ok || !isObject(challenge.body) || typeof challenge.body.challenge_id !== "string") {
      throw apiError(`${method} challenge`, challenge);
    }
    const verified = await post(
      `/auth_attempts/${attemptId}/challenges/${encodeURIComponent(challenge.body.challenge_id)}/verify`,
      proof,
    );
    if (!verified.ok) throw proofError(method, verified, admin);
  };

  // The bootstrap document registers the admin's email as the unique attribute
  // that identifies them, so that is the attribute the proof names.
  await prove("identifier", { login_name: admin.email, attribute_name: ADMIN_IDENTIFIER_ATTRIBUTE });
  await prove("password", { password: admin.password });

  const handoff = await post(`/auth_attempts/${attemptId}/handoff`, {});
  if (!handoff.ok || !isObject(handoff.body) || typeof handoff.body.handoff_token !== "string") {
    throw apiError("handoff", handoff);
  }
  return { handoffToken: handoff.body.handoff_token, projectId: PLATFORM_PROJECT_ID, publishableKey };
}

/**
 * The platform project's browser-safe key, which is also what authorises the
 * auth-attempt calls above. Its absence means this server was not started with
 * the platform project, which no amount of retrying will change.
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
        // cannot fix this on its own: the instance has to stop first.
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

/**
 * A rejected identifier proof means this server never imported the admin — an
 * older data directory, say — which is worth saying plainly, because no retry
 * fixes it and the generic proof error would send the reader hunting.
 */
function proofError(method: string, res: JsonResponse, admin: LocalAdmin): ZitadelError {
  const code = isObject(res.body) && typeof res.body.code === "string" ? res.body.code : undefined;
  if (method === "identifier" && code === "att.proof_rejected") {
    return new ZitadelError("E_AUTH", `The local server has no user ${admin.email}`, {
      hint: "The local data directory predates the local admin. Run `zitadel reset --force`, then `zitadel start`.",
    });
  }
  return apiError(`${method} proof`, res);
}

/** Writes owner-only, failing quietly when another run got there first. */
async function writePrivateIfAbsent(path: string, content: string): Promise<boolean> {
  try {
    await writeFile(path, content, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  await chmod(path, 0o600).catch(() => undefined);
  return true;
}

type JsonResponse = { ok: boolean; status: number; body: unknown };

async function fetchJson(url: string, init: RequestInit): Promise<JsonResponse> {
  const res = await bounded(url, init);
  return { ok: res.ok, status: res.status, body: await safeJson(res) };
}

/**
 * Every request here runs against an already-healthy local server, so a stall
 * is a wedged server rather than a slow start. Bounding each one keeps
 * `zitadel start` from hanging on a socket that accepts and never answers.
 */
async function bounded(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
}

async function safeJson(res: Response): Promise<unknown> {
  return res.json().catch(() => undefined);
}

function apiError(action: string, res: JsonResponse): ZitadelError {
  const message =
    isObject(res.body) && typeof res.body.message === "string" ? res.body.message : "unexpected response";
  return new ZitadelError("E_AUTH", `Local admin ${action} failed (${String(res.status)}): ${message}`, {
    details: { status: res.status, body: res.body },
  });
}

import { pbkdf2Sync, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
 * The password is never printed. The CLI uses it to run the real login flow
 * headlessly and turns the resulting one-time handoff token into a console
 * sign-in link (`/ui/console/login?handoff=…`).
 */
export const LOCAL_ADMIN_FILE = `${LOCAL_RUNTIME_DIR}/admin.json`;
export const LOCAL_ADMIN_USER_FILE = `${LOCAL_RUNTIME_DIR}/admin-user.json`;

const PLATFORM_PROJECT_ID = "proj_platform";
// The default user schema the platform project is seeded with, under the
// server's default `schema.builtin_public_base`. CLI-managed servers do not
// override that base.
const DEFAULT_USER_SCHEMA_URL = "https://nextgen.com/api/schemas/default-human-user.json";
const ADMIN_USER_ID = "user_localadmin";
const ADMIN_TEAM_ID = "team_localadmin";
/** The local admin's sign-in identifier; the default user schema identifies users by email. */
export const LOCAL_ADMIN_EMAIL = "admin@zitadel.localhost";
const PBKDF2_ROUNDS = 210_000;
const MAX_FLOW_STEPS = 6;

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
  const parsed: unknown = JSON.parse(raw);
  if (
    !isObject(parsed) ||
    typeof parsed.email !== "string" ||
    typeof parsed.password !== "string" ||
    typeof parsed.user_id !== "string" ||
    typeof parsed.team_id !== "string"
  ) {
    throw new ZitadelError("E_VALIDATION", `${LOCAL_ADMIN_FILE} is malformed`, {
      hint: "Delete .zitadel/local/ and run `zitadel start` again.",
    });
  }
  return parsed as LocalAdmin;
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
    admin = {
      // A fixed, clearly-local identity rather than anything inferred from
      // Git config, which can carry a stale, work, or noreply address.
      email: LOCAL_ADMIN_EMAIL,
      password: randomBytes(24).toString("base64url"),
      user_id: ADMIN_USER_ID,
      team_id: ADMIN_TEAM_ID,
    };
    await writePrivate(join(cwd, LOCAL_ADMIN_FILE), `${JSON.stringify(admin, null, 2)}\n`);
  }

  const userFile = join(cwd, LOCAL_ADMIN_USER_FILE);
  await writePrivate(userFile, `${JSON.stringify(bootstrapUserDocument(admin), null, 2)}\n`);
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
}): Promise<{ team_id: string; claimed_at: string }> {
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
      return { team_id: teamId, claimed_at: new Date().toISOString() };
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
  const res = await fetch(
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
 * Runs the platform project's login flow for the admin, exactly as the login
 * widget would, and stops at the terminal handoff token without exchanging it.
 */
async function adminHandoff(
  serverUrl: string,
  admin: LocalAdmin,
): Promise<{ handoffToken: string; projectId: string; publishableKey: string }> {
  const runtimeRes = await fetchJson(`${serverUrl}/console/runtime.json`, { method: "GET" });
  const runtime = runtimeRes.body;
  if (
    !runtimeRes.ok ||
    !isObject(runtime) ||
    runtime.console_project_id !== PLATFORM_PROJECT_ID ||
    typeof runtime.publishable_key !== "string"
  ) {
    throw new ZitadelError(
      "E_VALIDATION",
      "The local server does not host the platform project, so the local admin cannot sign in",
      {
        hint: "Restart it with `zitadel start` so it boots with the platform project and the local admin.",
        details: { server_url: serverUrl, console_project_id: isObject(runtime) ? runtime.console_project_id : undefined },
      },
    );
  }
  const publishableKey = runtime.publishable_key;
  const origin = new URL(serverUrl).origin;
  let flowCookie: string | undefined;

  const flow = async (path: string, body: Record<string, unknown>) => {
    const res = await fetch(`${serverUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${publishableKey}`,
        origin,
        ...(flowCookie ? { cookie: flowCookie } : {}),
      },
      body: JSON.stringify(body),
    });
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";", 1);
      if (pair?.startsWith("_zflow=")) flowCookie = pair;
    }
    const json = await safeJson(res);
    if (!res.ok || !isObject(json)) {
      throw apiError(`flow ${path}`, { ok: res.ok, status: res.status, body: json });
    }
    return json;
  };

  let step = await flow("/flow", { project_id: PLATFORM_PROJECT_ID, purpose: "login" });
  for (let hop = 0; hop < MAX_FLOW_STEPS; hop += 1) {
    if (typeof step.handoff_token === "string") {
      return { handoffToken: step.handoff_token, projectId: PLATFORM_PROJECT_ID, publishableKey };
    }
    const current = isObject(step.step) ? step.step : {};
    if (current.name === "register" || current.name === "register-password") {
      // The login flow only routes to registration when the email is unknown:
      // the server was not started with this admin (for example an older data
      // directory). Refuse rather than sign a new user up.
      throw new ZitadelError("E_AUTH", `The local server has no user ${admin.email}`, {
        hint: "The local data directory predates the local admin. Run `zitadel reset --force`, then `zitadel start`.",
      });
    }
    const fields: Record<string, string> = {};
    for (const field of Array.isArray(current.fields) ? current.fields : []) {
      if (!isObject(field) || typeof field.name !== "string") continue;
      fields[field.name] = field.name.split("#").pop() === "password" ? admin.password : admin.email;
    }
    step = await flow(`/flow/${encodeURIComponent(String(step.id))}/submit`, {
      session_token: step.session_token,
      action: "submit",
      fields,
    });
  }
  throw new ZitadelError("E_AUTH", "The local admin login did not complete", {
    details: { last_step: isObject(step.step) ? step.step.name : undefined },
  });
}

async function writePrivate(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600).catch(() => undefined);
}

type JsonResponse = { ok: boolean; status: number; body: unknown };

async function fetchJson(url: string, init: RequestInit): Promise<JsonResponse> {
  const res = await fetch(url, init);
  return { ok: res.ok, status: res.status, body: await safeJson(res) };
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

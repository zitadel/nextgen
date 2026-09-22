import { pbkdf2Sync, randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { defaultHumanUserSchemaUrl } from "@zitadel/config";

import { ZitadelError } from "../errors";
import { isObject } from "../json";
import { LOCAL_RUNTIME_DIR } from "./runtime";
import { PLATFORM_PROJECT_ID } from "./platform";

/**
 * The local admin's two files under `.zitadel/local/` (gitignored):
 *
 * - `admin.json` — the credential the CLI keeps: email, generated password, ids.
 * - `admin-user.json` — the server's bootstrap user document, passed to the
 *   binary as `--user-file`. Carries a PBKDF2 hash, never the password.
 *
 * The password is never printed. It exists so the CLI can sign the developer in
 * (see `sign-in.ts`) without them registering on their own server.
 */
export const LOCAL_ADMIN_FILE = `${LOCAL_RUNTIME_DIR}/admin.json`;
export const LOCAL_ADMIN_USER_FILE = `${LOCAL_RUNTIME_DIR}/admin-user.json`;

/** The local admin's sign-in identifier; the default user schema identifies users by email. */
export const LOCAL_ADMIN_EMAIL = "admin@zitadel.localhost";

/**
 * Which user attribute identifies the admin. A project decides this for itself;
 * this one is the CLI's own, and `bootstrapUserDocument` below writes the email
 * under `email`, so that is what an identifier proof names.
 */
export const LOCAL_ADMIN_IDENTIFIER_ATTRIBUTE = "email";

const ADMIN_USER_ID = "user_localadmin";
const ADMIN_TEAM_ID = "team_localadmin";

const PBKDF2_ROUNDS = 210_000;

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
  } catch (error) {
    // Only a missing file means `start` never created the admin. A file that
    // exists but cannot be read is still the credential the server imported,
    // and minting a replacement would leave the two holding different passwords.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new ZitadelError("E_VALIDATION", `${LOCAL_ADMIN_FILE} cannot be read`, {
      hint: `Check that ${LOCAL_ADMIN_FILE} is readable by you; \`zitadel start\` writes it owner-only.`,
      details: { cause: error instanceof Error ? error.message : String(error) },
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw malformedAdminFile(error);
  }
  if (!isLocalAdmin(parsed)) {
    throw malformedAdminFile();
  }
  return parsed;
}

function isLocalAdmin(value: unknown): value is LocalAdmin {
  return (
    isObject(value) &&
    typeof value.email === "string" &&
    typeof value.password === "string" &&
    typeof value.user_id === "string" &&
    typeof value.team_id === "string"
  );
}

/**
 * Recovery needs both halves. `zitadel reset` clears the server's data but keeps
 * `admin.json`, so the next start would read the same broken file; deleting the
 * file alone leaves the server holding a hash of the old password, so the admin
 * could never sign in. Removing the file and resetting the data lets the next
 * start mint a fresh credential and import it.
 */
function malformedAdminFile(cause?: unknown): ZitadelError {
  return new ZitadelError("E_VALIDATION", `${LOCAL_ADMIN_FILE} is malformed`, {
    hint: `Delete ${LOCAL_ADMIN_FILE} and run \`zitadel reset --force\`, then \`zitadel start\`. Both are needed: reset keeps ${LOCAL_ADMIN_FILE}, and deleting it alone leaves the server holding the old password.`,
    nextCommands: [`rm ${LOCAL_ADMIN_FILE}`, "zitadel reset --force", "zitadel start"],
    ...(cause ? { details: { cause: cause instanceof Error ? cause.message : String(cause) } } : {}),
  });
}

/**
 * Creates the local admin on first use and (re)writes the server's bootstrap
 * user document, returning the credential and the document path for
 * `--user-file`. The server imports the user once; later starts skip it because
 * the user already exists, so the stored password stays valid.
 */
export async function ensureLocalAdmin(
  cwd: string,
  options: {
    /**
     * The server's `schema.builtin_public_base`, when the environment overrides
     * it. The platform project's default user schema is published under that
     * base, and a document naming a schema the server does not have is
     * bootstrapped against an empty placeholder — the admin could never sign in.
     */
    builtinSchemaBase?: string;
  } = {},
): Promise<{ admin: LocalAdmin; userFile: string }> {
  await mkdir(join(cwd, LOCAL_RUNTIME_DIR), { recursive: true, mode: 0o700 });

  const admin = (await readLocalAdmin(cwd)) ?? (await createLocalAdmin(cwd));

  // Readable beyond the owner, unlike admin.json: the docker runtime mounts
  // this document into a container running as the host user, and an unreadable
  // file fails the server's bootstrap import at startup. It carries a hash.
  // Written beside it and renamed into place: a concurrent start may be
  // launching a server that reads this document, and a rename is atomic where
  // an in-place rewrite is not.
  const userFile = join(cwd, LOCAL_ADMIN_USER_FILE);
  const schemaUrl = defaultHumanUserSchemaUrl(options.builtinSchemaBase || undefined);
  // Unique per write, not per process: two starts in one process (or a retry)
  // must not rename each other's staging file away.
  const staging = `${userFile}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(staging, `${JSON.stringify(bootstrapUserDocument(admin, schemaUrl), null, 2)}\n`, {
    mode: 0o644,
  });
  await chmod(staging, 0o644).catch(() => undefined);
  await rename(staging, userFile);

  return { admin, userFile };
}

/**
 * Mints the credential, or adopts the one a concurrent `zitadel start` in this
 * directory minted first. The write is exclusive so the two cannot each mint a
 * password and leave the bootstrap document holding the loser's hash.
 */
async function createLocalAdmin(cwd: string): Promise<LocalAdmin> {
  const candidate: LocalAdmin = {
    // A fixed, clearly-local identity rather than anything inferred from Git
    // config, which can carry a stale, work, or noreply address.
    email: LOCAL_ADMIN_EMAIL,
    password: randomBytes(24).toString("base64url"),
    user_id: ADMIN_USER_ID,
    team_id: ADMIN_TEAM_ID,
  };

  const path = join(cwd, LOCAL_ADMIN_FILE);
  const won = await writePrivateIfAbsent(path, `${JSON.stringify(candidate, null, 2)}\n`);
  return won ? candidate : ((await readLocalAdmin(cwd)) ?? candidate);
}

/** Writes owner-only, reporting `false` when another run got there first. */
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

function bootstrapUserDocument(admin: LocalAdmin, schemaUrl: string) {
  return {
    header: {
      project_id: PLATFORM_PROJECT_ID,
      team_id: admin.team_id,
      schema_url: schemaUrl,
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

/**
 * passlib's `$pbkdf2-sha256$rounds$salt$hash`, which passwap verifies on the
 * server (`internal/crypto/passwap.go`). Salt and digest use passlib's adapted
 * base64: `+` becomes `.` and the padding is dropped.
 */
function pbkdf2Hash(password: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, PBKDF2_ROUNDS, 32, "sha256");
  return `$pbkdf2-sha256$${String(PBKDF2_ROUNDS)}$${ab64(salt)}$${ab64(hash)}`;
}

function ab64(bytes: Buffer): string {
  return bytes.toString("base64").replace(/=+$/, "").replaceAll("+", ".");
}

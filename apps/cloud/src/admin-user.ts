/**
 * Bootstrap document for the seeded platform admin.
 *
 * Mirrors what `zitadel start` writes to `.zitadel/local/admin-user.json`
 * (apps/cli/src/lib/local-server/admin-credential.ts): the server imports it
 * once through `--user-file` into the reserved platform project and skips it
 * on later starts because the user already exists. The document carries a
 * PBKDF2 hash, never the password.
 */
import { pbkdf2Sync, randomBytes } from "node:crypto";

export const PLATFORM_PROJECT_ID = "proj_platform";
export const DEFAULT_SCHEMA_URL = "https://nextgen.com/api/schemas/default-human-user.json";
export const DEFAULT_ADMIN_USER_ID = "user_platformadmin";
export const DEFAULT_ADMIN_TEAM_ID = "team_platformadmin";

/** passlib's default; the server verifies through passwap (internal/crypto/passwap.go). */
export const PBKDF2_ROUNDS = 210_000;

export interface AdminCredential {
  email: string;
  password: string;
  user_id: string;
  team_id: string;
}

export interface BootstrapUserDocument {
  header: { project_id: string; team_id: string; schema_url: string; id: string };
  attributes: {
    username: string;
    email: string;
    "zitadel.source": "cli";
    "zitadel.default_user": true;
  };
  authenticators: { password: { encoded_hash: string; change_required: boolean } };
}

/** A fresh credential with a 192-bit random password. */
export function newAdminCredential(
  email: string,
  overrides: Partial<Omit<AdminCredential, "email">> = {},
): AdminCredential {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`admin email is not an address: ${email}`);
  }
  return {
    email,
    password: overrides.password ?? randomBytes(24).toString("base64url"),
    user_id: overrides.user_id ?? DEFAULT_ADMIN_USER_ID,
    team_id: overrides.team_id ?? DEFAULT_ADMIN_TEAM_ID,
  };
}

/** The `--user-file` document the server's bootstrap import validates. */
export function bootstrapUserDocument(
  admin: AdminCredential,
  schemaUrl: string = DEFAULT_SCHEMA_URL,
  salt: Buffer = randomBytes(16),
): BootstrapUserDocument {
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
      password: { encoded_hash: pbkdf2Hash(admin.password, salt), change_required: false },
    },
  };
}

/**
 * passlib's `$pbkdf2-sha256$rounds$salt$hash`. Salt and digest use passlib's
 * adapted base64: `+` becomes `.` and the padding is dropped.
 */
export function pbkdf2Hash(password: string, salt: Buffer = randomBytes(16)): string {
  const hash = pbkdf2Sync(password, salt, PBKDF2_ROUNDS, 32, "sha256");
  return `$pbkdf2-sha256$${String(PBKDF2_ROUNDS)}$${ab64(salt)}$${ab64(hash)}`;
}

/** Verifies a password against a hash produced by {@link pbkdf2Hash}. Test seam. */
export function verifyPbkdf2(password: string, encoded: string): boolean {
  const m = /^\$pbkdf2-sha256\$(\d+)\$([A-Za-z0-9./]+)\$([A-Za-z0-9./]+)$/.exec(encoded);
  if (!m) return false;
  const rounds = Number(m[1]);
  const salt = fromAb64(m[2] ?? "");
  const expected = fromAb64(m[3] ?? "");
  const actual = pbkdf2Sync(password, salt, rounds, expected.length, "sha256");
  return actual.equals(expected);
}

function ab64(bytes: Buffer): string {
  return bytes.toString("base64").replace(/=+$/, "").replaceAll("+", ".");
}

function fromAb64(text: string): Buffer {
  return Buffer.from(text.replaceAll(".", "+"), "base64");
}

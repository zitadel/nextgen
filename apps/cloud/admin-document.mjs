#!/usr/bin/env node
// Mints the hosted cloud's root admin: the credential that goes into the team
// password manager and the bootstrap user document the server imports on its
// first start (BOOTSTRAP_ADMIN_USER_JSON_B64, see launcher/main.go). Called by
// setup-secrets.sh; usable on its own:
//
//   node apps/cloud/admin-document.mjs --email admin@example.com --out DIR
//
// Writes, owner-only and never over an existing file:
//
//   DIR/admin.json       email, password, ids: the password manager's login item
//   DIR/admin-user.json  the document: the password's PBKDF2 hash, never the password
//
// The document mirrors what `zitadel start` writes for its local admin
// (apps/cli/src/lib/local-server/admin-credential.ts): same ids layout, same
// attributes, same passlib-style `$pbkdf2-sha256$` hash, which the server's
// passwap verifies. It names the platform project and the server's default
// user schema, published under schema.builtin_public_base; a document that
// names a schema the server does not have is imported against an empty
// placeholder and its admin could never sign in.
//
// Node only, no dependencies: the build and a developer's machine both have it.
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const PBKDF2_ROUNDS = 210_000;

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    out: { type: "string" },
    project: { type: "string", default: "proj_platform" },
    "user-id": { type: "string", default: "user_platformadmin" },
    "team-id": { type: "string", default: "team_platformadmin" },
    "schema-url": {
      type: "string",
      default: "https://zitadel.com/schemas/v1/default-human-user.json",
    },
  },
});

if (!values.email || !values.out) {
  console.error(
    "usage: admin-document.mjs --email ADDR --out DIR [--project ID] [--user-id ID] [--team-id ID] [--schema-url URL]",
  );
  process.exit(64);
}

const admin = {
  email: values.email,
  password: randomBytes(24).toString("base64url"),
  user_id: values["user-id"],
  team_id: values["team-id"],
};

const document = {
  header: {
    project_id: values.project,
    team_id: admin.team_id,
    schema_url: values["schema-url"],
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

mkdirSync(values.out, { recursive: true, mode: 0o700 });
// "wx": never over an existing file, whose password a server may already hold.
writeFileSync(join(values.out, "admin.json"), `${JSON.stringify(admin, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx",
});
writeFileSync(join(values.out, "admin-user.json"), `${JSON.stringify(document, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx",
});
console.log(
  `admin ${admin.email} (${admin.user_id}): ${join(values.out, "admin.json")}, document ${join(values.out, "admin-user.json")}`,
);

/**
 * passlib's `$pbkdf2-sha256$rounds$salt$hash`. Salt and digest use passlib's
 * adapted base64: `+` becomes `.` and the padding is dropped.
 */
function pbkdf2Hash(password) {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, PBKDF2_ROUNDS, 32, "sha256");
  return `$pbkdf2-sha256$${String(PBKDF2_ROUNDS)}$${ab64(salt)}$${ab64(hash)}`;
}

function ab64(bytes) {
  return bytes.toString("base64").replace(/=+$/, "").replaceAll("+", ".");
}

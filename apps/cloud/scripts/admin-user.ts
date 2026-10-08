#!/usr/bin/env tsx
/**
 * Mint the seeded platform admin for a deployment.
 *
 *   pnpm run admin-user -- --email ops@example.com --out ./secrets
 *
 * Writes two files into --out (created 0700):
 *   admin.json        the credential: email, generated password, ids. Keep it
 *                     in the password manager; it is never printed.
 *   admin-user.json   the server's bootstrap document (hash only), the value
 *                     of BOOTSTRAP_ADMIN_USER_JSON_B64 once base64-encoded.
 *
 * Prints the base64 of admin-user.json on stdout so it can be piped straight
 * into `vercel env add BOOTSTRAP_ADMIN_USER_JSON_B64 production --sensitive`.
 * The entrypoint renders it to a file and passes `--user-file`; the server
 * imports the user once and skips it afterwards.
 */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { bootstrapUserDocument, DEFAULT_SCHEMA_URL, newAdminCredential } from "../src/admin-user";

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    email: { type: "string" },
    out: { type: "string" },
    "schema-url": { type: "string", default: DEFAULT_SCHEMA_URL },
    "user-id": { type: "string" },
    "team-id": { type: "string" },
  },
});

if (!values.email || !values.out) {
  console.error("usage: admin-user.ts --email <address> --out <dir> [--schema-url <url>]");
  process.exit(2);
}

const admin = newAdminCredential(values.email, {
  ...(values["user-id"] ? { user_id: values["user-id"] } : {}),
  ...(values["team-id"] ? { team_id: values["team-id"] } : {}),
});
const doc = bootstrapUserDocument(admin, values["schema-url"]);

mkdirSync(values.out, { recursive: true, mode: 0o700 });
const credentialPath = join(values.out, "admin.json");
const documentPath = join(values.out, "admin-user.json");
writeFileSync(credentialPath, `${JSON.stringify(admin, null, 2)}\n`, { mode: 0o600 });
chmodSync(credentialPath, 0o600);
const documentJson = `${JSON.stringify(doc, null, 2)}\n`;
writeFileSync(documentPath, documentJson, { mode: 0o600 });

console.error(`wrote ${credentialPath} (keep private) and ${documentPath}`);
process.stdout.write(Buffer.from(documentJson, "utf8").toString("base64"));

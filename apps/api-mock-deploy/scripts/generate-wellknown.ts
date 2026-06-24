import { buildOpenIdConfiguration } from "@zitadel/api-mock/openid-configuration";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveIssuer } from "../src/issuer.js";

/**
 * Emit the OIDC discovery document as a static asset under
 * `public/.well-known/`.
 *
 * Vercel reserves the `/.well-known/*` path and will not route it through
 * the catch-all rewrite to the function, so the only way to serve
 * `/.well-known/openid-configuration` on a preview is a static file.
 * It is generated here (not committed) using this deployment's
 * `VERCEL_URL`, so the issuer matches what the function signs and
 * verifies. `jwks_uri` points at `/auth/keys` — the same JWKS the
 * function serves, but on a path that *is* eligible for the rewrite
 * (unlike `/.well-known/jwks.json`).
 */
// This script only runs during the Vercel build, where `VERCEL_URL` is
// always present. If it is missing, `resolveIssuer` would silently fall
// back to a localhost issuer and emit a static discovery document that
// breaks every preview client in a hard-to-debug way — fail loudly instead.
if (!process.env.VERCEL_URL?.trim()) {
  console.error(
    "[api-mock-deploy] VERCEL_URL is not set — refusing to write a static " +
      "discovery document with a localhost issuer (this script is meant to run " +
      "in the Vercel build, where VERCEL_URL is defined).",
  );
  process.exit(1);
}

const issuer = resolveIssuer();
const document = buildOpenIdConfiguration(issuer, { jwksUri: `${issuer}/auth/keys` });

const wellKnownDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
  ".well-known",
);
await mkdir(wellKnownDir, { recursive: true });
await writeFile(
  resolve(wellKnownDir, "openid-configuration"),
  JSON.stringify(document, null, 2) + "\n",
);

console.log(`[api-mock-deploy] wrote public/.well-known/openid-configuration (issuer ${issuer})`);

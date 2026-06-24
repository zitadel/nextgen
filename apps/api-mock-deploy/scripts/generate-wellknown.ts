import { buildOpenIdConfiguration } from "@zitadel/api-mock/server";
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

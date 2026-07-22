import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * README content the CLI copies to `.zitadel/schemas/README.md` during setup.
 * Source of truth is `packages/config/defaults/README-schemas.md`; the Go
 * server-side embed reads the same file (see `defaults.go`).
 */
export function schemasReadmeContent(): string {
  return readFileSync(readmeUrl("README-schemas.md"), "utf8");
}

/**
 * README content the CLI copies to `.zitadel/flows/README.md` during setup.
 * Source of truth is `packages/config/defaults/README-flows.md`.
 */
export function flowsReadmeContent(): string {
  return readFileSync(readmeUrl("README-flows.md"), "utf8");
}

/**
 * README content the CLI copies to `.zitadel/branding/README.md` when a
 * branding design is ejected. Source of truth is
 * `packages/config/defaults/README-branding.md`.
 */
export function brandingReadmeContent(): string {
  return readFileSync(readmeUrl("README-branding.md"), "utf8");
}

function readmeUrl(filename: string): string {
  return fileURLToPath(new URL(`../defaults/${filename}`, import.meta.url));
}

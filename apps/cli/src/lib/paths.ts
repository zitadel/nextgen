import { resolve } from "node:path";

export function resolveCwd(cwd?: string): string {
  return resolve(cwd ?? process.cwd());
}

export const MANAGED_MARKER = "// zitadel-cli: managed-file v1";

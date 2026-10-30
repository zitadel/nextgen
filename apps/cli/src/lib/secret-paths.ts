/**
 * Whether `path` must never be committed: a `.zitadel/secret`, anything under `.zitadel/local/`, or an `.env*` file other than `.env.example`.
 *
 * Matched without regard to case, since `.ENV` is the same file as `.env` on
 * macOS and Windows.
 */
export function isSecretPath(path: string): boolean {
  const lower = path.toLowerCase();
  const name = lower.split("/").pop() ?? lower;
  if (lower === ".zitadel/secret" || lower.endsWith("/.zitadel/secret")) {
    return true;
  }
  if (isLocalRuntimePath(lower)) {
    return true;
  }
  return name.startsWith(".env") && name !== ".env.example";
}

/** Whether `path` is under `.zitadel/local/`, at any depth, where the local server keeps its admin credential and data. */
export function isLocalRuntimePath(path: string): boolean {
  return /(^|\/)\.zitadel\/local(\/|$)/i.test(path);
}

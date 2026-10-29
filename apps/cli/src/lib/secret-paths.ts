/** Whether `path` must never be committed: a `.zitadel/secret`, anything under `.zitadel/local/`, or an `.env*` file other than `.env.example`. */
export function isSecretPath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  if (path === ".zitadel/secret" || path.endsWith("/.zitadel/secret")) {
    return true;
  }
  if (isLocalRuntimePath(path)) {
    return true;
  }
  return name.startsWith(".env") && name !== ".env.example";
}

/** Whether `path` is under `.zitadel/local/`, at any depth, where the local server keeps its admin credential and data. */
export function isLocalRuntimePath(path: string): boolean {
  return /(^|\/)\.zitadel\/local(\/|$)/.test(path);
}

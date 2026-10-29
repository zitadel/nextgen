/**
 * Paths that must never be committed or printed, whatever `.gitignore` happens to say.
 *
 * `.zitadel/local/` holds the local admin credential and the server's data
 * directory. Only the `.gitignore` line `start` appends keeps it out, so a
 * project missing that line would otherwise commit the credential.
 */
export function isSecretPath(path: string): boolean {
  const name = path.split("/").pop() ?? path;
  if (path === ".zitadel/secret" || path.endsWith("/.zitadel/secret")) {
    return true;
  }
  if (/(^|\/)\.zitadel\/local(\/|$)/.test(path)) {
    return true;
  }
  return name.startsWith(".env") && name !== ".env.example";
}

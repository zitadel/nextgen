/**
 * Relative directory (from the project root) where local policy files live:
 * one `<operation>.json` instance per guarded operation (ADR 066). Owned
 * here so commands, syncers, and tests share one source of truth.
 */
export const POLICIES_DIR = ".zitadel/policies";

/**
 * The file name an operation's instance is scaffolded under. Operations are
 * dotted (`user.password.save`), which is a fine file stem: the sync loop only
 * looks at the `.json` extension.
 */
export function policyFileName(operation: string): string {
  return `${operation}.json`;
}

/**
 * Converts a local instance file to the wire body of `POST /policies`:
 * strips the editor `$schema` affordance. Nothing else differs, the platform
 * stores the document as sent.
 */
export function toPolicyWireBody(data: object): object {
  const { $schema, ...rest } = data as { $schema?: unknown };
  void $schema;
  return rest;
}

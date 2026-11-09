/**
 * Public surface for the user-schema domain. Every caller outside this
 * module imports from here (not from individual files), the same
 * discipline as `lib/flows/`.
 *
 * **Source of truth.** The wire shape lives in
 * `@zitadel/api/generated/model` (orval-generated from the
 * OpenAPI spec). Callers that need the type import `CreateSchemaBody`
 * from there directly; callers that need the runtime validator import
 * the matching Zod schema from
 * `@zitadel/api/generated/endpoints/zitadelNextGen.zod`. The default
 * schema/flow bodies the CLI scaffolds are composed in
 * `@zitadel/config/defaults` (`getDefaultHumanUserSchema`) — the single
 * source of field defaults.
 *
 * **Dependency rule.** No upward imports (`commands/`, `sync/`, etc.)
 * and no filesystem I/O. Reading and writing local files is the
 * caller's responsibility, served by `apps/cli/src/lib/json-dir.ts`
 * plus this module's {@link SCHEMAS_DIR} constant.
 */

import { schemaFileIssues } from "@zitadel/config/meta-schemas";

/**
 * Relative directory (from the project root) where local user-schema
 * files live. Owned here so callers (`commands/*`, `sync/syncers.ts`)
 * and tests share a single source of truth for the path; the runtime
 * never depends on it directly because `lib/user-schema` does not touch
 * the filesystem. The counterpart of `lib/flows`' `FLOWS_DIR`.
 */
export const SCHEMAS_DIR = ".zitadel/schemas";

/**
 * One line per rule a schema file breaks, as `schemaFileIssues` judges it,
 * each led by the schema's `objectType` (or its place in the list) and the
 * path of the object at fault, so `deploy` and `doctor` word a failure alike.
 */
export function schemaFileFailures(schemas: readonly Record<string, unknown>[]): string[] {
  return schemas.flatMap((schema, index) => {
    const handle =
      typeof schema.objectType === "string" ? schema.objectType : `schema #${index + 1}`;
    return schemaFileIssues(schema).map(
      (issue) => `${handle}: ${issue.path || "(root)"} ${issue.message}`,
    );
  });
}

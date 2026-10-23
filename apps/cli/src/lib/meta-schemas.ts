/**
 * The editor meta-schemas a project carries in `.zitadel/meta/`, as this CLI
 * writes them. One writer for `setup`, `branding eject` and `doctor`, so the
 * file a project holds and the file `doctor` compares it with cannot drift.
 *
 * They are CLI-owned generated output: pure functions of `@zitadel/config`'s
 * `metaSchemaFiles()` and the CLI version, read only by editors and agents,
 * never by `plan`, `apply` or the server. The `zitadel …` mentions in their
 * descriptions become the runnable public command on the way out
 * ({@link normalizePublicCliJson}), so they differ between CLI versions.
 */
import { META_SCHEMA_DIR, metaSchemaFiles } from "@zitadel/config/meta-schemas";

import { normalizePublicCliJson } from "./public-cli";

/** One meta-schema file: its project-relative path, its body, and the bytes written. */
export type ProjectMetaSchema = {
  path: string;
  body: object;
  contents: string;
};

/** Every meta-schema file a project should hold, as this CLI version writes it. */
export function projectMetaSchemas(cliVersion: string): ReadonlyArray<ProjectMetaSchema> {
  return metaSchemaFiles().map((file) => {
    const body = normalizePublicCliJson(file.body, cliVersion);
    return {
      path: `${META_SCHEMA_DIR}/${file.name}`,
      body,
      contents: `${JSON.stringify(body, null, 2)}\n`,
    };
  });
}

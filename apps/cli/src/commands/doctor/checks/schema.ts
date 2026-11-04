import { join } from "node:path";

import { schemaFileIssues } from "@zitadel/config/meta-schemas";

import { readJsonDir } from "../../../lib/json-dir";
import { SCHEMAS_DIR } from "../../../lib/user-schema";
import { AbstractSanityCheck, type CheckContext, type CheckOutcome } from "./types";

/**
 * Verifies local schema config files with `schemaFileIssues` from
 * `@zitadel/config/meta-schemas`, the check the release pipeline runs, so
 * doctor and `deploy` can never disagree about a file: the `kind`
 * discriminator (`user-schema` / `schema-url`), the fields the platform
 * requires, and the keys the user meta-schema allows.
 */
export class SchemaCheck extends AbstractSanityCheck {
  readonly name = "schema";
  readonly path = SCHEMAS_DIR;
  protected readonly summary = "User schemas are valid Zitadel schema bodies";

  /**
   * An empty `.zitadel/schemas/` is a warning, not a failure: projects
   * created before editable config existed were seeded server-side and have
   * no local schema files, and there is no safe auto-fix that could invent
   * them. Only invalid files fail the check.
   */
  override async run(ctx: CheckContext): Promise<CheckOutcome> {
    const schemas = await readJsonDir(join(ctx.cwd, SCHEMAS_DIR));
    if (schemas.length === 0) {
      return {
        name: this.name,
        status: "warn",
        message:
          `No schema files found in ${SCHEMAS_DIR} — this project predates editable ` +
          "schema config or setup was interrupted. New projects scaffold editable " +
          "defaults via `zitadel setup`.",
        path: this.path,
      };
    }
    return super.run(ctx);
  }

  protected async verify(ctx: CheckContext): Promise<void> {
    const schemas = await readJsonDir(join(ctx.cwd, SCHEMAS_DIR));
    // Named as deploy names them, since the check points at the directory.
    const failures = schemas.flatMap((schema, index) => {
      const handle =
        typeof schema.objectType === "string" ? schema.objectType : `schema #${index + 1}`;
      return schemaFileIssues(schema).map(
        (issue) => `${handle}: ${issue.path || "/"} ${issue.message}`,
      );
    });
    if (failures.length > 0) {
      throw new Error(failures.join("; "));
    }
  }
}

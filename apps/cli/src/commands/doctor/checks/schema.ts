import { join } from "node:path";

import { schemaConfigSchema } from "@zitadel/config/schemas";

import { readJsonDir } from "../../../lib/json-dir";
import { SCHEMAS_DIR } from "../../../lib/user-schema";
import { AbstractSanityCheck, type CheckContext, type CheckOutcome } from "./types";

/**
 * Verifies local schema config files round-trip through the canonical
 * `schemaConfigSchema` from `@zitadel/config/schemas` — the same Zod the
 * sync engine validates with, so doctor and `apply` can never disagree
 * about a file. The union enforces the `kind` discriminator
 * (`user-schema` / `schema-url`) and the `metaSchema`/`x-auth-methods`/etc.
 * fields the platform requires.
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
    for (const schema of schemas) {
      const result = schemaConfigSchema.safeParse(schema);
      if (!result.success) {
        throw new Error(
          result.error.issues
            .map((issue) => `${issue.path.join(".") || "/"} ${issue.message}`)
            .join("; "),
        );
      }
    }
  }
}

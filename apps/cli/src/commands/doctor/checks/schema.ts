import { join } from "node:path";

import { CreateSchemaBody } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";

import { readJsonDir } from "../../../lib/json-dir";
import { SCHEMAS_DIR } from "../../../lib/user-schema";
import { AbstractSanityCheck, type CheckContext } from "./types";

/**
 * Verifies local schema config files round-trip through the generated
 * `CreateSchemaBody` Zod (the orval equivalent of
 * `api/openapi/endpoints/schemas/user-schema.yaml`). The Zod union enforces
 * the `kind` discriminator (`user-schema` / `schema-url`) and the
 * `metaSchema`/`x-auth-methods`/etc. fields the platform requires.
 */
export class SchemaCheck extends AbstractSanityCheck {
  readonly name = "schema";
  readonly path = SCHEMAS_DIR;
  protected readonly summary = "User schemas are valid Zitadel schema bodies";

  protected async verify(ctx: CheckContext): Promise<void> {
    const schemas = await readJsonDir(join(ctx.cwd, SCHEMAS_DIR));
    if (schemas.length === 0) {
      throw new Error(`No schema files found in ${SCHEMAS_DIR}`);
    }
    for (const schema of schemas) {
      const result = CreateSchemaBody.safeParse(schema);
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

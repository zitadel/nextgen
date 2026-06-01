import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { CreateSchemaBody } from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen.zod";

import { AbstractSanityCheck, type CheckContext } from "./types";

/**
 * Verifies `.zitadel/schemas/user.json` round-trips through the generated
 * `CreateSchemaBody` Zod (the orval equivalent of
 * `api/openapi/endpoints/schemas/user-schema.yaml`). The Zod union enforces
 * the `kind` discriminator (`user-schema` / `schema-url`) and the
 * `metaSchema`/`x-auth-methods`/etc. fields the platform requires.
 */
export class SchemaCheck extends AbstractSanityCheck {
  readonly name = "schema";
  readonly path = ".zitadel/schemas/user.json";
  protected readonly summary = "User schema is a valid Zitadel schema body";

  protected async verify(ctx: CheckContext): Promise<void> {
    const schema = JSON.parse(
      await readFile(join(ctx.cwd, ".zitadel/schemas/user.json"), "utf8"),
    ) as unknown;
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

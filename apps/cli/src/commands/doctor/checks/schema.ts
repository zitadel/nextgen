import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { validateJsonSchema } from "../../../lib/user-schema";
import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies `.zitadel/schemas/user.json` is a valid JSON Schema. */
export class SchemaCheck extends AbstractSanityCheck {
  readonly name = "schema";
  readonly path = ".zitadel/schemas/user.json";
  protected readonly summary = "User schema is a valid JSON Schema";

  protected async verify(ctx: CheckContext): Promise<void> {
    const schema = JSON.parse(
      await readFile(join(ctx.cwd, ".zitadel/schemas/user.json"), "utf8"),
    ) as unknown;
    const result = validateJsonSchema(schema);
    if (!result.valid) {
      throw new Error(result.errors.join(", "));
    }
  }
}

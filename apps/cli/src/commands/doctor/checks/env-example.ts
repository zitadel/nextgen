import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies `.env.example` documents the required Zitadel keys. */
export class EnvExampleCheck extends AbstractSanityCheck {
  readonly name = "env-example";
  readonly path = ".env.example";
  protected readonly summary = ".env.example references required keys";

  protected async verify(ctx: CheckContext): Promise<void> {
    const contents = await readFile(join(ctx.cwd, ".env.example"), "utf8");
    for (const key of ["ZITADEL_PROJECT_ID", "ZITADEL_ENVIRONMENT", "ZITADEL_ISSUER"]) {
      if (!contents.includes(`${key}=`)) {
        throw new Error(`missing ${key}`);
      }
    }
  }
}

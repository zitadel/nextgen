import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AbstractSanityCheck, type CheckContext } from "./types";

/** The keys `.env.example` must document for a Zitadel-managed project. */
const REQUIRED_KEYS = ["ZITADEL_PROJECT_ID", "ZITADEL_ENVIRONMENT", "ZITADEL_ISSUER"];

/** Verifies `.env.example` documents the required Zitadel keys; appends any missing. */
export class EnvExampleCheck extends AbstractSanityCheck {
  readonly name = "env-example";
  readonly path = ".env.example";
  protected readonly summary = ".env.example references required keys";

  protected async verify(ctx: CheckContext): Promise<void> {
    const contents = await readFile(join(ctx.cwd, ".env.example"), "utf8");
    for (const key of REQUIRED_KEYS) {
      if (!contents.includes(`${key}=`)) {
        throw new Error(`missing ${key}`);
      }
    }
  }

  override async fix(ctx: CheckContext): Promise<void> {
    const path = join(ctx.cwd, ".env.example");
    const existing = await readFile(path, "utf8").catch(() => "");
    const missing = REQUIRED_KEYS.filter((key) => !existing.includes(`${key}=`));
    if (missing.length === 0 || ctx.dryRun) {
      return;
    }
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(path, `${existing}${prefix}${missing.map((key) => `${key}=`).join("\n")}\n`);
  }
}

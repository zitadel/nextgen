import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { AbstractSanityCheck, type CheckContext } from "./types";

/** Verifies `.gitignore` excludes the local secret and env files. */
export class GitignoreCheck extends AbstractSanityCheck {
  readonly name = "gitignore";
  readonly path = ".gitignore";
  protected readonly summary = ".gitignore protects local secret/env files";

  protected async verify(ctx: CheckContext): Promise<void> {
    const contents = await readFile(join(ctx.cwd, ".gitignore"), "utf8");
    const lines = contents.split(/\r?\n/g);
    for (const entry of [".zitadel/secret", ".env*", "!.env.example"]) {
      if (!lines.includes(entry)) {
        throw new Error(`missing ${entry}`);
      }
    }
  }
}

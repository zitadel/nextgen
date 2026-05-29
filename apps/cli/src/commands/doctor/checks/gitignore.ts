import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { AbstractSanityCheck, type CheckContext } from "./types";

/** The entries `.gitignore` must carry to keep secrets and env files untracked. */
const REQUIRED_ENTRIES = [".zitadel/secret", ".env*", "!.env.example"];

/** Verifies `.gitignore` excludes the local secret and env files; appends any missing. */
export class GitignoreCheck extends AbstractSanityCheck {
  readonly name = "gitignore";
  readonly path = ".gitignore";
  protected readonly summary = ".gitignore protects local secret/env files";

  protected async verify(ctx: CheckContext): Promise<void> {
    const lines = (await readFile(join(ctx.cwd, ".gitignore"), "utf8")).split(/\r?\n/g);
    for (const entry of REQUIRED_ENTRIES) {
      if (!lines.includes(entry)) {
        throw new Error(`missing ${entry}`);
      }
    }
  }

  override async fix(ctx: CheckContext): Promise<void> {
    const path = join(ctx.cwd, ".gitignore");
    const existing = await readFile(path, "utf8").catch(() => "");
    const lines = existing.split(/\r?\n/g);
    const missing = REQUIRED_ENTRIES.filter((entry) => !lines.includes(entry));
    if (missing.length === 0 || ctx.dryRun) {
      return;
    }
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(path, `${existing}${prefix}${missing.join("\n")}\n`);
  }
}

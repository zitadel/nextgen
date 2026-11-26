import { join } from "node:path";
import { parseEnv } from "node:util";

import { errorMessage } from "@/lib/errors";
import { FsDeniedError, FsIsDirectoryError, FsNotFoundError, readFile, writeFile } from "@/lib/fs";

import type { CheckContext, CheckOutcome, SanityCheck } from "./types";
import { Project, type GitignoreRule } from "@/lib/project";

/**
 * Verifies `.gitignore` ignores every file that holds a secret and keeps
 * `.env.example`, judged by what its lines do together, as git reads them.
 *
 * A secret git would commit fails the check. An ignored `.env.example` only
 * warns: sign-in still works, but the variable names it documents never reach
 * the repository, as in an app an older setup left with `.env*` after the
 * generator's own `!.env.example`.
 *
 * Implements {@link SanityCheck} directly: the abstract base's verify-throws
 * contract can only express pass/fail.
 */
export class GitignoreCheck implements SanityCheck {
  readonly name = "gitignore";
  readonly path = ".gitignore";

  async run(ctx: CheckContext): Promise<CheckOutcome> {
    try {
      return await this.evaluate(ctx);
    } catch (error) {
      if (error instanceof FsDeniedError) {
        return {
          name: this.name,
          path: this.path,
          status: "fail",
          message: errorMessage(error),
        };
      }
      if (error instanceof FsIsDirectoryError) {
        return {
          name: this.name,
          path: this.path,
          status: "fail",
          message: errorMessage(error),
        };
      }
      throw error;
    }
  }

  /**
   * Appends what makes every rule hold, after everything the file already has.
   * A file meant to be committed is un-ignored only while it names variables
   * and holds no value, so a repair never puts a secret within git's reach.
   */
  async fix(ctx: CheckContext): Promise<void> {
    const path = join(ctx.cwd, this.path);
    const existing = (await readText(path)) ?? "";
    const safe = await holdsNamesOnly(ctx.cwd, Project.gitignore().rules);
    const missing = Project.gitignore(
      Project.gitignore().rules.filter((rule) => {
        return isIgnoredByRule(rule) || safe;
      }),
    ).entriesToAppend(existing);
    if (missing.length === 0 || ctx.dryRun) {
      return;
    }
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(path, `${existing}${prefix}${missing.join("\n")}\n`);
  }

  private async evaluate(ctx: CheckContext): Promise<CheckOutcome> {
    const base = { name: this.name, path: this.path };
    const text = await readText(join(ctx.cwd, this.path));
    if (text === undefined) {
      return {
        ...base,
        status: "fail",
        message: `${this.path} was not found`,
      };
    }
    const broken = Project.gitignore().broken(text);
    const exposed = broken.filter(isIgnoredByRule);
    if (exposed.length > 0) {
      return {
        ...base,
        status: "fail",
        message: `${this.path} does not ignore ${pathsOf(exposed)}`,
      };
    }
    if (broken.length === 0) {
      return {
        ...base,
        status: "pass",
        message: ".gitignore protects local secret/env files",
      };
    }
    if (!(await holdsNamesOnly(ctx.cwd, broken))) {
      return {
        ...base,
        status: "warn",
        message: `${this.path} ignores ${pathsOf(broken)}, which holds values; un-ignore it once it names variables only`,
      };
    }
    return {
      ...base,
      status: "warn",
      message: `${this.path} ignores ${pathsOf(broken)}, so the variable names it documents are never committed`,
      remedy: ctx.suggest({
        id: "doctor",
        flags: { fix: true },
      }),
    };
  }
}

function isIgnoredByRule(rule: GitignoreRule): boolean {
  return rule.ignored;
}

function pathsOf(rules: ReadonlyArray<GitignoreRule>): string {
  return rules
    .map((rule) => {
      return rule.path;
    })
    .join(", ");
}

/** Whether every file the rules keep is absent, or assigns each variable it names nothing. */
async function holdsNamesOnly(cwd: string, rules: ReadonlyArray<GitignoreRule>): Promise<boolean> {
  const kept = await Promise.all(
    rules
      .filter((rule) => {
        return !rule.ignored;
      })
      .map((rule) => {
        return readText(join(cwd, rule.path));
      }),
  );
  return kept.every((text) => {
    return (
      text === undefined ||
      Object.values(parseEnv(text)).every((value) => {
        return value === "";
      })
    );
  });
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof FsNotFoundError) {
      return undefined;
    }
    throw error;
  }
}

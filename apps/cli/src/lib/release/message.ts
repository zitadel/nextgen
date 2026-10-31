import { readFile } from "node:fs/promises";

import { Flags } from "@oclif/core";

import { ZitadelError } from "../errors";
import { refuseBlank } from "../oclif/flags";
import { headSubject, worktreeIsDirty } from "./git";

/** The longest message the server records on a release or a deployment, in code points. */
const MESSAGE_MAX_LENGTH = 1024;

/** `-m/--message`: refused when blank or longer than the server records. */
export function messageFlag(description: string) {
  return Flags.custom<string>({
    char: "m",
    description,
    parse: async (input) => {
      const value = refuseBlank(input, "--message", "the value is empty");
      if (Array.from(value).length > MESSAGE_MAX_LENGTH) {
        throw new ZitadelError(
          "E_VALIDATION",
          `the message is longer than ${MESSAGE_MAX_LENGTH} characters`,
          { hint: "Pass a shorter summary with -m.", details: { argument: "--message" } },
        );
      }
      return value;
    },
  })();
}

/**
 * The message a deploy or preview records: `-m`, else what the build is of —
 * the pull request's title on GitHub, Vercel's commit message, or the subject
 * of the current commit when the worktree is clean.
 */
export async function deployMessage(
  flag: string | undefined,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  if (flag !== undefined) {
    return flag;
  }
  // A pull_request build checks out GitHub's merge commit, whose subject only
  // names two shas, so the pull request's title stands in or nothing does.
  if (env.GITHUB_EVENT_NAME === "pull_request" || env.GITHUB_EVENT_NAME === "pull_request_target") {
    return cut(await pullRequestTitle(env.GITHUB_EVENT_PATH));
  }
  const vercel = env.VERCEL_GIT_COMMIT_MESSAGE?.split("\n")[0];
  if (vercel?.trim()) {
    return cut(vercel);
  }
  // Uncommitted changes are not what the commit describes.
  if (await worktreeIsDirty(cwd)) {
    return undefined;
  }
  return cut((await headSubject(cwd)) ?? undefined);
}

/** The title in a GitHub pull_request event payload, or undefined when it cannot be read. */
async function pullRequestTitle(path: string | undefined): Promise<string | undefined> {
  if (!path) {
    return undefined;
  }
  try {
    const event = JSON.parse(await readFile(path, "utf8")) as {
      pull_request?: { title?: unknown };
    };
    const title = event.pull_request?.title;
    return typeof title === "string" ? title : undefined;
  } catch {
    return undefined;
  }
}

/** Trimmed and cut to the server's limit by code points, or undefined when blank. */
function cut(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? Array.from(trimmed).slice(0, MESSAGE_MAX_LENGTH).join("") : undefined;
}

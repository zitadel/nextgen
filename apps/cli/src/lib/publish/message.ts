import { readFile } from "node:fs/promises";

import { isObject } from "@/lib/json";

import { headSubject, worktreeIsDirty } from "./git";

/**
 * The longest message the server records on a release or a deployment, in code points.
 */
export const MESSAGE_MAX_LENGTH = 1024;

/**
 * The GitHub events whose checkout is a merge commit with a meaningless subject.
 */
const PULL_REQUEST_EVENTS: readonly string[] = ["pull_request", "pull_request_target"];

/**
 * Whether `message` is longer than the server records.
 *
 * @param message - The message.
 * @returns Whether it has more code points than the server keeps.
 */
export function messageTooLong(message: string): boolean {
  return Array.from(message).length > MESSAGE_MAX_LENGTH;
}

/**
 * The message a deploy or preview records: `-m`, else what the build is of —
 * the pull request's title on GitHub, Vercel's commit message, or the subject
 * of the current commit when the worktree is clean.
 *
 * @param flag - What `-m` gave, if anything.
 * @param cwd - The project root.
 * @param env - The run's environment, which names the CI build.
 * @returns The message, or undefined when there is none to record.
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
  if (env.GITHUB_EVENT_NAME !== undefined && PULL_REQUEST_EVENTS.includes(env.GITHUB_EVENT_NAME)) {
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
  const subject = await headSubject(cwd);

  return cut(subject ?? undefined);
}

/**
 * The title in a GitHub pull_request event payload.
 *
 * @param path - Where GitHub wrote the payload, if it did.
 * @returns The title, or undefined when it cannot be read.
 */
async function pullRequestTitle(path: string | undefined): Promise<string | undefined> {
  if (!path) {
    return undefined;
  }
  try {
    const event: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isObject(event) || !isObject(event.pull_request)) {
      return undefined;
    }
    const title = event.pull_request.title;
    if (typeof title !== "string") {
      return undefined;
    }

    return title;
  } catch {
    return undefined;
  }
}

/**
 * A message trimmed and cut to the server's limit by code points.
 *
 * @param value - The message, if any.
 * @returns The message, or undefined when blank.
 */
function cut(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return Array.from(trimmed).slice(0, MESSAGE_MAX_LENGTH).join("");
}

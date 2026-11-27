import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { type ObservedRequest, requestsObserved } from "@tests/helpers/platform";

/**
 * The platform operations a dry run may call although they are not a `GET`:
 * each only reads or validates, and keeps nothing. A dry run asking the
 * platform for anything else, a write of any kind, is a dry run that changes
 * the platform.
 *
 * - `/users/query`, `/idps/query`: a query a filter is too large to send as a
 *   `GET`.
 * - `/policies/evaluate`: asks what a policy would decide, and keeps nothing.
 * - `/releases/build`: builds the release a deploy would publish, to validate
 *   the bundle, and publishes none.
 */
const READS_BY_POST: readonly string[] = [
  "/users/query",
  "/idps/query",
  "/policies/evaluate",
  "/releases/build",
];

/** The folders a run changes without meaning to: git's bookkeeping and installed packages. */
const UNWATCHED: readonly string[] = [".git", "node_modules"];

/**
 * Whether a request changes the platform.
 *
 * @param request - What the platform was asked.
 * @returns True for anything that is not a read.
 */
function writes(request: ObservedRequest): boolean {
  if (request.method === "GET" || request.method === "HEAD") {
    return false;
  }

  return !READS_BY_POST.some((read) => {
    return request.path.endsWith(read);
  });
}

/**
 * What is in a project folder, by path, as a hash of each file.
 *
 * @param directory - The folder.
 * @returns A hash per file, relative to the folder.
 */
async function treeOf(directory: string): Promise<ReadonlyMap<string, string>> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => {
    return (
      entry.isFile() &&
      !relative(directory, join(entry.parentPath, entry.name))
        .split(sep)
        .some((part) => {
          return UNWATCHED.includes(part);
        })
    );
  });
  const hashed = await Promise.all(
    files.map(async (entry) => {
      const path = join(entry.parentPath, entry.name);

      return [
        relative(directory, path),
        createHash("sha1")
          .update(await readFile(path))
          .digest("hex"),
      ] as const;
    }),
  );

  return new Map(hashed);
}

/**
 * Runs a command that was given `--dry-run` and holds it to the one thing a
 * dry run promises: nothing changed. The platform was asked only what a read
 * or a validation asks ({@link READS_BY_POST}), and no file in the project
 * folder was created, changed or removed.
 *
 * @param command - The command as the spec gave it, for the failure to name.
 * @param directory - The project folder the run acts on.
 * @param run - Runs the command.
 * @returns What the run returned.
 * @throws {Error} Naming the command and each request or file it changed.
 */
export async function holdingADryRunToNothing<T>(
  command: string,
  directory: string,
  run: () => Promise<T>,
): Promise<T> {
  const before = await treeOf(directory);
  const asked = requestsObserved().length;
  const result = await run();
  const after = await treeOf(directory);
  const changes = [
    ...requestsObserved()
      .slice(asked)
      .filter(writes)
      .map((request) => {
        return `asked the platform to ${request.method} ${request.path}`;
      }),
    ...[...after].flatMap(([path, hash]) => {
      if (!before.has(path)) {
        return [`created ${path}`];
      }

      return before.get(path) === hash ? [] : [`changed ${path}`];
    }),
    ...[...before.keys()]
      .filter((path) => {
        return !after.has(path);
      })
      .map((path) => {
        return `removed ${path}`;
      }),
  ];
  if (changes.length > 0) {
    throw new Error(`a dry run of \`${command}\` changed things: ${changes.join("; ")}`);
  }

  return result;
}

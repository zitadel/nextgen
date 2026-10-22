import type { Plugin } from "vite";
import { searchForWorkspaceRoot } from "vite";

import { PLUGIN_PREFIX } from "./defaults.ts";
import { posixPath } from "./entries.ts";

/** The files among `files` (name, text) whose text names the build machine's `workspaceRoot`. */
export function filesWithBuildPaths(
  files: Iterable<readonly [string, string]>,
  workspaceRoot: string,
): string[] {
  return [...files].filter(([, text]) => text.includes(workspaceRoot)).map(([name]) => name);
}

/** Fails when any of `files` names the build machine's `workspaceRoot`. */
export function assertNoBuildPaths(
  files: Iterable<readonly [string, string]>,
  workspaceRoot: string,
): void {
  const leaking = filesWithBuildPaths(files, workspaceRoot);
  if (leaking.length > 0)
    throw new Error(
      `build output names the build machine's path ${workspaceRoot}: ${leaking.join(", ")}`,
    );
}

/**
 * Fails the build when an emitted file contains an absolute path into the workspace (a virtual
 * module's id in a region comment, a `__dirname` frozen at build time): published output must not
 * depend on, or reveal, where it was built.
 */
export function noBuildPaths(root: () => string): Plugin {
  return {
    name: `${PLUGIN_PREFIX}:no-build-paths`,
    apply: "build",
    generateBundle(_options, bundle) {
      // Output names files with forward slashes on every platform.
      const workspaceRoot = posixPath(searchForWorkspaceRoot(root()));
      assertNoBuildPaths(
        Object.values(bundle).map((file) => [
          file.fileName,
          file.type === "chunk" ? file.code : typeof file.source === "string" ? file.source : "",
        ]),
        workspaceRoot,
      );
    },
  };
}

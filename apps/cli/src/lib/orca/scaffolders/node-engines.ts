import { spawnSync } from "node:child_process";

import semver from "semver";

/**
 * How a framework CLI treats a Node outside its `engines.node`, which decides
 * what setup does about it:
 *
 * - `refuse`: the CLI exits on it (the Angular CLI's `bin/ng.js` exits 3), so
 *   setup refuses it first, with a message that names the range.
 * - `warn`: the CLI carries on, at most printing its own warning into output
 *   setup never shows (`nuxi` warns, `create-vite` and `create-next-app` say
 *   nothing, and npx only prints `EBADENGINE`), so setup refuses nothing and
 *   reports the warning itself.
 */
export type NodeEnforcement = "refuse" | "warn";

/**
 * What a scaffolder declares about the Node the framework CLI it runs needs.
 * The range itself is asked of npm at run time, so a new release's range
 * applies without a CLI release.
 */
export interface NodeEngines {
  /** How the CLI is named in messages, e.g. `The Angular CLI` or `create-vite`. */
  readonly label: string;
  /** The npm package spec setup runs, so npm reports the range of that very version. */
  readonly spec: string;
  /** The range to use when npm cannot report one, as of the version setup runs. */
  readonly fallback: string;
  readonly enforcement: NodeEnforcement;
}

/** Whether a framework CLI runs on a Node, refuses it, or runs on it with a warning. */
export type NodeSupport = "supported" | "warned" | "refused";

/**
 * How long npm may take to report a framework CLI's range before setup falls
 * back to the declared one. npm's own fetch timeout is five minutes, and on a
 * network that cannot reach the registry the scaffolding command fails
 * anyway, so the lookup must not hold setup up for long.
 */
export const NODE_ENGINES_TIMEOUT_MS = 5_000;

/**
 * Decides a Node version against a framework CLI's `engines.node`, the way
 * that CLI does:
 *
 * - `refuse` follows the Angular CLI's own `bin/ng.js`. Each `||` part of the
 *   range, stripped of its operators, names a major and its lowest
 *   `minor.patch`; a Node of that major at or above it is supported (so
 *   `>=26.0.0` covers Node 26 only, as it does for `ng`). An odd major between
 *   the lowest and highest listed majors (Node 23 and 25 for Angular 22) is
 *   warned about, as it never reaches LTS. Anything else, including a major
 *   above the highest listed one, is refused.
 * - `warn` follows the plain semver range, which is what `nuxi` checks: a
 *   Node in the range is supported, any other is warned about, none is refused.
 */
export function nodeSupport(
  node: string,
  range: string,
  enforcement: NodeEnforcement,
): NodeSupport {
  if (enforcement === "warn") {
    return semver.satisfies(node, range) ? "supported" : "warned";
  }
  const [major = 0, minor = 0, patch = 0] = node.split(".", 3).map(Number);
  const listed = range
    .replace(/[\^~<>=]/g, "")
    .split("||")
    .map((part) => part.trim().split(".", 3).map(Number));
  const supported = listed.some(
    ([lMajor, lMinor = 0, lPatch = 0]) =>
      lMajor === major && (minor > lMinor || (minor === lMinor && patch >= lPatch)),
  );
  if (supported) {
    return "supported";
  }
  const majors = listed.map(([lMajor = 0]) => lMajor);
  const between = major > Math.min(...majors) && major < Math.max(...majors);
  return major % 2 === 1 && between ? "warned" : "refused";
}

/**
 * The Node range the framework CLI that setup will run publishes, asked of
 * npm. Falls back to the declared range when npm is unavailable, takes longer
 * than {@link NODE_ENGINES_TIMEOUT_MS} (a killed spawn has no exit status), or
 * answers with something that is not a range.
 *
 * On Windows npm is a `.cmd` shim, which `spawnSync` cannot start without a
 * shell (it reports ENOENT, or EINVAL on current Node), so the lookup would
 * always fall back there. The command line is constant, so running it through
 * the shell on Windows is safe. The call is synchronous and may block for up to
 * the timeout, once, before scaffolding starts; nothing else is running in the
 * process at that point.
 */
export function nodeEnginesRange(
  engines: NodeEngines,
  cwd: string,
  platform: NodeJS.Platform,
): string {
  const result = spawnSync("npm", ["view", engines.spec, "engines.node"], {
    cwd,
    encoding: "utf8",
    timeout: NODE_ENGINES_TIMEOUT_MS,
    shell: platform === "win32",
  });
  const range = result.status === 0 ? String(result.stdout ?? "").trim() : "";
  return range && semver.validRange(range) ? range : engines.fallback;
}

/**
 * What every scaffolder that runs `create-vite` (React, Vue, Solid, Svelte and
 * Qwik) declares. `create-vite` never checks the Node itself, so setup only
 * warns.
 */
export const CREATE_VITE_NODE_ENGINES: NodeEngines = {
  label: "create-vite",
  spec: "create-vite@latest",
  fallback: "^20.19.0 || >=22.12.0",
  enforcement: "warn",
};

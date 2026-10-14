import { spawnSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { basename, join } from "node:path";

import semver from "semver";

import { ZitadelError } from "../../errors";
import { reportWarning } from "../../warnings";
import { AbstractCLIScaffolder } from "./cli";

/** The Angular CLI setup runs, for both `ng new` and the engine lookup. */
const ANGULAR_CLI = "@angular/cli@latest";

/**
 * The Node versions the Angular CLI accepts (its `engines.node`), used only
 * when npm cannot report the published range. Angular 22's range.
 */
export const ANGULAR_CLI_NODE_FALLBACK = "^22.22.3 || ^24.15.0 || >=26.0.0";

/**
 * How long npm may take to report the Angular CLI's range before setup falls
 * back to {@link ANGULAR_CLI_NODE_FALLBACK}. npm's own fetch timeout is five
 * minutes, and on a network that cannot reach the registry `ng new` fails
 * anyway, so the lookup must not hold setup up for long.
 */
export const ANGULAR_CLI_ENGINES_TIMEOUT_MS = 5_000;

/** Whether the Angular CLI runs on a Node, refuses it, or runs on it with a warning. */
export type AngularNodeSupport = "supported" | "warned" | "refused";

/**
 * Decides a Node version the way the Angular CLI's own `bin/ng.js` does, so
 * setup refuses exactly what `ng` would refuse:
 *
 * - Each `||` part of the range, stripped of its operators, names a major and
 *   its lowest `minor.patch`; a Node of that major at or above it is
 *   supported. `>=26.0.0` therefore covers Node 26 only, as it does for `ng`.
 * - An odd major between the lowest and highest listed majors (Node 23 and 25
 *   for Angular 22) runs with a warning, since it never reaches LTS.
 * - Anything else, including a major above the highest listed one, is
 *   refused: `ng` exits 3 on it.
 */
export function angularNodeSupport(node: string, range: string): AngularNodeSupport {
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
 * Derives a valid Angular project name from the target directory. `ng new`
 * validates the name against `^[a-zA-Z0-9-~][a-zA-Z0-9-._~]*$` and rejects `.`,
 * so we slugify the directory's basename (lowercase, non-alphanumerics → `-`)
 * and guarantee a leading letter by prefixing `app-` when the slug does not
 * start with one (`app-zitadel` when the basename slugifies to nothing).
 */
function angularProjectName(cwd: string): string {
  const slug = basename(cwd)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return /^[a-z]/.test(slug) ? slug : `app-${slug || "zitadel"}`;
}

/**
 * The Node range the Angular CLI that `ng new` will run publishes, asked of
 * npm so a new Angular release's range applies without a CLI release. Falls
 * back to {@link ANGULAR_CLI_NODE_FALLBACK} when npm is unavailable, takes
 * longer than {@link ANGULAR_CLI_ENGINES_TIMEOUT_MS} (a killed spawn has no exit
 * status), or answers with something that is not a range.
 */
function angularCliNodeRange(cwd: string): string {
  const result = spawnSync("npm", ["view", ANGULAR_CLI, "engines.node"], {
    cwd,
    encoding: "utf8",
    timeout: ANGULAR_CLI_ENGINES_TIMEOUT_MS,
  });
  const range = result.status === 0 ? String(result.stdout ?? "").trim() : "";
  return range && semver.validRange(range) ? range : ANGULAR_CLI_NODE_FALLBACK;
}

/**
 * Scaffolds a new Angular app with the Angular CLI, then removes the starter
 * `app.ts`/`app.html` root component (and its now-unreferenced `app.css`) so the
 * patcher can write the managed ones without colliding with boilerplate. The
 * managed component uses only `templateUrl`, so `app.css` would otherwise be a
 * dangling file eject never cleans up. Unlike `create-vite`/`nuxi`, `ng new`
 * needs a real project name plus `--directory .` to populate the current dir.
 *
 * The Angular CLI refuses Node versions outside its `engines.node` range,
 * which is narrower than this CLI's own. That refusal would surface as a
 * generic command failure, so the range is checked first with the Angular
 * CLI's own rule ({@link angularNodeSupport}): a Node it refuses is refused
 * here, naming the versions it needs, and one it only warns about is warned
 * about here too.
 */
export class AngularScaffolder extends AbstractCLIScaffolder {
  readonly displayName = "Angular";
  readonly supportedFrameworks: ReadonlyArray<string> = ["angular"];

  private readonly nodeVersion: string;

  /** `nodeVersion` defaults to the running Node; tests pass another. */
  constructor(nodeVersion: string = process.versions.node) {
    super();
    this.nodeVersion = nodeVersion;
  }

  async scaffold(cwd: string, _framework: string): Promise<void> {
    const range = angularCliNodeRange(cwd);
    const support = angularNodeSupport(this.nodeVersion, range);
    if (support === "warned") {
      reportWarning(
        `The Angular CLI supports Node ${range}; it runs on Node v${this.nodeVersion} with a warning, as odd-numbered Node versions never reach LTS`,
      );
    }
    if (support === "refused") {
      throw new ZitadelError(
        "E_VALIDATION",
        `The Angular CLI needs Node ${range}; this is Node v${this.nodeVersion}`,
        {
          hint: "Switch to a Node version in that range and rerun, or create the Angular app with that Node and run setup inside it.",
          details: { node: this.nodeVersion, required: range },
        },
      );
    }
    this.runCommand(
      "npx",
      [
        "-y",
        ANGULAR_CLI,
        "new",
        angularProjectName(cwd),
        "--directory",
        ".",
        "--defaults",
        "--style=css",
        "--ssr=false",
        "--skip-git",
      ],
      cwd,
    );
    await rm(join(cwd, "src/app/app.ts"), { force: true });
    await rm(join(cwd, "src/app/app.html"), { force: true });
    await rm(join(cwd, "src/app/app.css"), { force: true });
  }
}

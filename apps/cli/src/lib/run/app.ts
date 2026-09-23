import { detectDevPort } from "../orca/detectors/port";
import { readPackageJson, type PackageJson } from "../orca/detectors/package-json";
import { detectPackageManager, devCommandFor } from "../package-manager";

export type AppCommand = {
  args: ReadonlyArray<string>;
  command: string;
  /** How the command is written in output, e.g. `pnpm dev`. */
  display: string;
  /** The port the dev script will listen on, for the session banner. */
  port?: number;
};

/** Why no app dev server will be supervised this session. */
export type AppSkipped = { reason: string };

export type AppResolution = AppCommand | AppSkipped;

export function isAppSkipped(resolution: AppResolution): resolution is AppSkipped {
  return "reason" in resolution;
}

/**
 * Decides how to start the app's dev server: the `dev` script of the project
 * in `cwd`, run through the package manager the project declares, or the
 * caller's explicit override.
 *
 * A project with no `dev` script is not an error, since `zitadel run` still
 * has a server to supervise and config to apply, so the reason is reported and
 * the session continues without an app.
 */
export async function resolveAppCommand(
  cwd: string,
  override?: string,
): Promise<AppResolution> {
  if (override) {
    const parts = override.trim().split(/\s+/);
    const command = parts[0];
    if (!command) {
      return { reason: "the --app-command value is empty" };
    }
    return { command, args: parts.slice(1), display: override.trim() };
  }

  let pkg: PackageJson;
  try {
    pkg = await readPackageJson(cwd);
  } catch {
    return { reason: "no readable package.json in this directory" };
  }
  if (typeof pkg.scripts?.dev !== "string") {
    return { reason: 'package.json has no "dev" script' };
  }

  const dev = devCommandFor(await detectPackageManager(cwd));
  return {
    command: dev.command,
    args: dev.args,
    display: dev.display,
    port: await detectDevPort(cwd, pkg),
  };
}

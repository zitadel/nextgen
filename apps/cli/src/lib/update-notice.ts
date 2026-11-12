import { Dependencies } from "@/lib/upgrade/dependencies";

import { wrapForBox } from "./box";
import { command, notice } from "./style";
import { upgradeCommand } from "./suggestion";
import { escapeControlCharacters } from "./terminal-text";
import { drawBox } from "./ui/layout";
import { updateCheckDisabled, ZITADEL_SCOPE, zitadelChannel } from "./zitadel-packages";

/**
 * The box `zitadel --version` ends with when something is behind the latest
 * release, or `undefined` when nothing is. It compares the project's pins as well
 * as the CLI: under `npx @zitadel/cli@latest` the CLI is the newest by
 * definition, and what has gone stale is the app.
 *
 * A version on either side of an arrow is semver by the time it is drawn, so
 * nothing in one needs spelling out. A package name is only known to start with
 * the scope, and this box is written straight to stderr rather than through the
 * command result that spells a value out for the terminal, so the name is
 * spelled out here.
 *
 * @param input.cliVersion - The running CLI's version.
 * @param input.cwd - The project directory.
 * @param input.env - The run's environment.
 * @param input.columns - The terminal's width.
 * @returns The box, or `undefined` when nothing is behind, the check is off, or
 * the lookup found nothing.
 */
export async function updateNotice(input: {
  cliVersion: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  columns?: number;
}): Promise<string | undefined> {
  const { cliVersion, cwd, env, columns } = input;
  if (updateCheckDisabled(env)) {
    return undefined;
  }
  const release = await zitadelChannel(cliVersion, env).latest();
  if (release === undefined) {
    return undefined;
  }
  const dependencies = await Dependencies.read(cwd, ZITADEL_SCOPE).catch(() => {
    return undefined;
  });

  const behind: string[] = [];
  if (release.isNewerThan(cliVersion)) {
    behind.push(`CLI ${cliVersion} → ${release.version}`);
  }
  for (const dependency of dependencies?.exact() ?? []) {
    if (dependency.isBehind(release.version)) {
      const name = escapeControlCharacters(dependency.name);
      behind.push(`${name} ${dependency.specifier} → ${release.version}`);
    }
  }
  if (behind.length === 0) {
    return undefined;
  }

  const lines = [...behind, "", command(upgradeCommand(cliVersion))];
  return drawBox(wrapForBox(lines.join("\n"), columns), "Update available", notice);
}

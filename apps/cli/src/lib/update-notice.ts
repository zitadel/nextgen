import { exactZitadelPins } from "@/lib/zitadel-pins";

import { wrapForBox } from "./box";
import { command, notice } from "./style";
import type { SuggestedCommand } from "./suggestion";
import { escapeControlCharacters } from "./terminal-text";
import { drawBox } from "./ui/layout";
import { isNewerVersion, latestCliVersion, updateCheckDisabled } from "./update-check";

/**
 * The box `zitadel --version` ends with when something is behind the latest
 * release, or `undefined` when nothing is. It compares the project's pins as
 * well as the CLI: under `npx @zitadel/cli@latest` the CLI is the newest by
 * definition, and what has gone stale is the app.
 *
 * @param input.cliVersion - The release of the CLI that is running.
 * @param input.upgrade - The `upgrade` command the box quotes, rendered by the caller.
 * @param input.cwd - The directory whose pins are compared.
 * @param input.env - The process environment.
 * @param input.columns - The terminal width to wrap to, if any.
 * @returns The box, or `undefined` when nothing is behind.
 */
export async function updateNotice(input: {
  cliVersion: string;
  upgrade: SuggestedCommand;
  cwd: string;
  env: NodeJS.ProcessEnv;
  columns?: number;
}): Promise<string | undefined> {
  const { cliVersion, cwd, env, columns } = input;
  if (updateCheckDisabled(env)) {
    return undefined;
  }
  const latest = await latestCliVersion({ cliVersion, env });
  if (latest === undefined) {
    return undefined;
  }
  const pins =
    (await exactZitadelPins(cwd).catch(() => {
      return undefined;
    })) ?? [];
  // A version on either side of the arrow is semver by the time it is here, so
  // there is nothing in one to spell out. A package name is only known to start
  // with `@zitadel/`, and this box is written straight to stderr rather than
  // through `emit`, so it is spelled out here — as the upgrade report does for
  // the same name.
  const behind = [
    ...(isNewerVersion(latest, cliVersion) ? [`CLI ${cliVersion} → ${latest}`] : []),
    ...pins
      .filter(([, version]) => {
        return isNewerVersion(latest, version);
      })
      .map(([name, version]) => {
        return `${escapeControlCharacters(name)} ${version} → ${latest}`;
      }),
  ];
  if (behind.length === 0) {
    return undefined;
  }
  return drawBox(
    wrapForBox([...behind, "", command(input.upgrade)].join("\n"), columns),
    "Update available",
    notice,
  );
}

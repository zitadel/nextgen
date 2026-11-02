import { box } from "consola/utils";

import { exactZitadelPins } from "../commands/doctor/checks/dependency-version";
import { command, wrapForBox } from "./box";
import { upgradeCommand } from "./suggestion";
import { isNewerVersion, latestCliVersion, updateCheckDisabled } from "./update-check";

/**
 * The box `zitadel --version` ends with when something is behind the latest
 * release, or `undefined` when nothing is. It compares the project's pins as
 * well as the CLI: under `npx @zitadel/cli@latest` the CLI is the newest by
 * definition, and what has gone stale is the app.
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
  const latest = await latestCliVersion({ cliVersion, env });
  if (latest === undefined) {
    return undefined;
  }
  const pins = (await exactZitadelPins(cwd).catch(() => undefined)) ?? [];
  const behind = [
    ...(isNewerVersion(latest, cliVersion) ? [`CLI ${cliVersion} → ${latest}`] : []),
    ...pins
      .filter(([, version]) => isNewerVersion(latest, version))
      .map(([name, version]) => `${name} ${version} → ${latest}`),
  ];
  if (behind.length === 0) {
    return undefined;
  }
  return box(wrapForBox([...behind, "", command(upgradeCommand(cliVersion))].join("\n"), columns), {
    title: "Update available",
    style: { padding: 1, borderStyle: "rounded", borderColor: "cyan" },
  });
}

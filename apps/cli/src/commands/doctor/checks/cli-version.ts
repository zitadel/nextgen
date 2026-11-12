import { upgradeCommand } from "@/lib/suggestion";
import { ReleaseChannel, ZITADEL } from "@/lib/upgrade";

import type { CheckOutcome } from "./types";

/**
 * Whether this CLI is the newest release on its dist-tag. A plain function, as
 * the local runtime checks are, because it needs no project: it runs in any
 * directory. Only ever pass or warn, since an older CLI still works, and a
 * lookup that finds nothing passes: not knowing is no reason to warn.
 */
export async function checkCliVersion(input: {
  cliVersion: string;
  env: NodeJS.ProcessEnv;
  /** `--cwd` as typed, which the suggested command carries. */
  typedCwd?: string;
}): Promise<CheckOutcome> {
  const { cliVersion, env, typedCwd } = input;
  const base = { name: "cli-version" };
  const channel = new ReleaseChannel(ZITADEL, cliVersion, env);
  if (channel.isDisabled()) {
    return {
      ...base,
      status: "pass",
      message: `CLI ${cliVersion}; update check is off`,
    };
  }
  const latest = await channel.latest();
  if (latest === undefined) {
    return {
      ...base,
      status: "pass",
      message: `CLI ${cliVersion}; could not look up the latest version`,
    };
  }
  if (!latest.isNewerThan(cliVersion)) {
    return {
      ...base,
      status: "pass",
      message: `CLI ${cliVersion} is the latest version`,
    };
  }
  return {
    ...base,
    status: "warn",
    message: `CLI ${cliVersion} is behind the latest version, ${latest.version}`,
    details: {
      current: cliVersion,
      latest: latest.version,
      remedy_command: upgradeCommand(cliVersion, typedCwd),
    },
  };
}

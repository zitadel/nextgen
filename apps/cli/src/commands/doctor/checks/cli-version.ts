import type { Suggest } from "@/lib/suggestion";
import { updateCheckDisabled, zitadelChannel } from "@/lib/zitadel-packages";

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
  /** Renders the suggested command with the run's own scope. */
  suggest: Suggest;
}): Promise<CheckOutcome> {
  const { cliVersion, env, suggest } = input;
  const base = { name: "cli-version" };
  if (updateCheckDisabled(env)) {
    return {
      ...base,
      status: "pass",
      message: `CLI ${cliVersion}; update check is off`,
    };
  }
  const latest = await zitadelChannel(cliVersion, env).latest();
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
      remedy_command: suggest({ id: "upgrade" }),
    },
  };
}

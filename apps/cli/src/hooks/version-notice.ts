import type { Hook } from "@oclif/core";

/** Whether these arguments print the version: oclif's `--version`, or `version` for a person. */
export function isVersionRun(argv: readonly string[]): boolean {
  return argv[0] === "--version" || (argv[0] === "version" && !argv.includes("--json"));
}

/**
 * Ends `zitadel --version` with the update box. oclif prints the version itself
 * and returns, so `finally` is the one place that runs after it.
 *
 * The box goes to stderr, and only with a terminal on both streams: stdout stays
 * the one line `$(zitadel --version)` reads, and such a run never asks the
 * registry. It runs after every command, so everything else is loaded only once
 * this is a version run for a person.
 */
const hook: Hook<"finally"> = async ({ config }) => {
  if (!isVersionRun(process.argv.slice(2)) || !process.stdout.isTTY || !process.stderr.isTTY) {
    return;
  }
  try {
    const { updateNotice } = await import("@/cli/notice");
    const { suggesterFor } = await import("@/lib/suggestion");
    const notice = await updateNotice({
      cliVersion: config.version,
      upgrade: suggesterFor(config, {}, config.version)({ id: "upgrade" }),
      cwd: process.cwd(),
      env: process.env,
      columns: process.stdout.columns,
    });
    if (notice !== undefined) {
      process.stderr.write(`${notice}\n`);
    }
  } catch {
    // Advice about the version must never break printing the version.
  }
};

export default hook;

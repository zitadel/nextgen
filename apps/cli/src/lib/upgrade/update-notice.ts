import { wrapForBox } from "@/lib/box";
import { command, notice } from "@/lib/style";
import { upgradeCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { drawBox } from "@/lib/ui/layout";

import { ReleaseChannel } from "./release-channel";
import { ScopedDependencies } from "./scoped-dependencies";
import type { UpgradeTarget } from "./upgrade-target";

/**
 * The box `--version` ends with when something is behind the latest release. It
 * compares the project's pins as well as the CLI: under `npx <cli>@latest` the
 * CLI is the newest by definition, and what has gone stale is the app.
 */
export class UpdateNotice {
  /** What is being upgraded. */
  private readonly target: UpgradeTarget;
  /** What the run was given. */
  private readonly options: Readonly<{
    cliVersion: string;
    cwd: string;
    env: NodeJS.ProcessEnv;
    columns?: number;
  }>;

  /**
   * @param target - What is being upgraded.
   * @param options.cliVersion - The running CLI's version.
   * @param options.cwd - The project directory.
   * @param options.env - The run's environment.
   * @param options.columns - The terminal's width.
   */
  constructor(
    target: UpgradeTarget,
    options: Readonly<{
      cliVersion: string;
      cwd: string;
      env: NodeJS.ProcessEnv;
      columns?: number;
    }>,
  ) {
    this.target = target;
    this.options = options;
  }

  /** The box, or `undefined` when nothing is behind, the check is off or the lookup found nothing. */
  async render(): Promise<string | undefined> {
    const { cliVersion, cwd, env, columns } = this.options;
    const channel = new ReleaseChannel(this.target, cliVersion, env);
    if (channel.isDisabled()) {
      return undefined;
    }
    const release = await channel.latest();
    if (release === undefined) {
      return undefined;
    }
    const dependencies = await ScopedDependencies.read(cwd, this.target.scope).catch(() => {
      return undefined;
    });
    // A version on either side of the arrow is semver by the time it is here, so
    // there is nothing in one to spell out. A package name is only known to start
    // with the scope, and this box is written straight to stderr rather than
    // through `emit`, so it is spelled out here — as the upgrade report does for
    // the same name.
    const behind = [
      ...(release.isNewerThan(cliVersion) ? [`CLI ${cliVersion} → ${release.version}`] : []),
      ...(dependencies?.exact() ?? [])
        .filter((dependency) => {
          return dependency.isBehind(release.version);
        })
        .map((dependency) => {
          return `${escapeControlCharacters(dependency.name)} ${dependency.specifier} → ${release.version}`;
        }),
    ];
    if (behind.length === 0) {
      return undefined;
    }
    return drawBox(
      wrapForBox([...behind, "", command(upgradeCommand(cliVersion))].join("\n"), columns),
      "Update available",
      notice,
    );
  }
}

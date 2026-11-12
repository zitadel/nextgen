import { wrapForBox } from "@/lib/box";
import { command, notice } from "@/lib/style";
import { upgradeCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { drawBox } from "@/lib/ui/layout";
import { ScopedDependencies } from "@/lib/upgrade/scoped-dependencies";

import { ZITADEL } from "./zitadel";
import { ZitadelReleaseChannel } from "./zitadel-release-channel";

/** What an {@link UpdateNotice} is given. */
export type UpdateNoticeOptions = Readonly<{
  cliVersion: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  columns?: number;
}>;

/**
 * The box `--version` ends with when something is behind the latest release. It
 * compares the project's pins as well as the CLI: under `npx <cli>@latest` the
 * CLI is the newest by definition, and what has gone stale is the app.
 */
export class UpdateNotice {
  /** What the run was given. */
  private readonly options: UpdateNoticeOptions;

  /**
   * @param options.cliVersion - The running CLI's version.
   * @param options.cwd - The project directory.
   * @param options.env - The run's environment.
   * @param options.columns - The terminal's width.
   */
  constructor(options: UpdateNoticeOptions) {
    this.options = options;
  }

  /** The box, or `undefined` when nothing is behind, the check is off or the lookup found nothing. */
  async render(): Promise<string | undefined> {
    const { cliVersion, cwd, env, columns } = this.options;
    if (ZitadelReleaseChannel.isDisabled(env)) {
      return undefined;
    }
    const release = await new ZitadelReleaseChannel(cliVersion, env).latest();
    if (release === undefined) {
      return undefined;
    }
    const dependencies = await ScopedDependencies.read(cwd, ZITADEL.scope).catch(() => {
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

import { existsSync } from "node:fs";
import { join } from "node:path";

import { Cmd } from "@/lib/cmd";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { painted } from "@/lib/oclif/rendering";
import { Suggestible } from "@/lib/oclif/suggestible";
import { newestCliCommand } from "@/lib/public-cli";
import { SHARED_SKILLS_DIR } from "@/lib/skills/add";
import { strong } from "@/lib/style";
import { type SuggestedCommand, unscopedCommand } from "@/lib/suggestion";
import { BreakingChangesBanner, Upgrader, ZITADEL } from "@/lib/upgrade";

/**
 * `zitadel upgrade` — move this project to the latest release.
 *
 * The CLI usually runs through `npx @zitadel/cli@latest`, so what goes stale is
 * the app: this re-pins its exactly-pinned `@zitadel/*` packages to the latest
 * release, with the project's own package manager, then has that release's
 * `doctor --fix` write what it generates. A range or dist-tag is a resolution
 * choice the user made, as `doctor`'s `dependency-version` check also holds, so
 * it is reported and left alone.
 */
export default class Upgrade extends Suggestible(BaseCommand) {
  static override description =
    "Upgrade this project to the latest Zitadel release.\n\nRe-pins the project's exactly-pinned @zitadel/* packages with its own package manager, then runs the new release's doctor --fix to refresh generated files. Run it as npx @zitadel/cli@latest upgrade so the newest release does the upgrading.";
  static override group = CommandGroups.diagnostics;
  static override groupOrder = 2;

  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --dry-run",
  ];

  // Everything here is about npm and the project: nothing to ask a server.
  static override meta = {
    resolveServer: false,
  };

  protected async execute({ flags }: Admitted<typeof Upgrade>): Promise<JsonEnvelope> {
    const upgrader = new Upgrader(ZITADEL, {
      cliVersion: this.cliVersion,
      cwd: this.cwd,
      typedCwd: flags.cwd,
      env: this.env,
      json: this.isJson,
      noTelemetry: flags.telemetry === false,
      dryRun: this.dryRun,
      signal: this.signal,
      retry: this.suggest("upgrade"),
    });
    const plan = await upgrader.plan();

    // Before anything changes, so the person reads it while they can still stop.
    if (!plan.upToDate) {
      this.log(new BreakingChangesBanner(plan.breaking).render());
    }
    const { refresh, installed, report } = await upgrader.apply(plan);

    // At the new version, and from the shell's directory like every suggestion.
    const atTarget = (args: string): SuggestedCommand => {
      return unscopedCommand(
        flags.cwd === undefined ? args : `${args} ${Cmd.option("--cwd", flags.cwd)}`,
        plan.target,
      );
    };
    const commands: SuggestedCommand[] = [
      ...(this.dryRun && !plan.upToDate ? [this.suggest("upgrade")] : []),
      ...(refresh === "failed" ? [atTarget("doctor --fix")] : []),
      ...(refresh === "issues" ? [atTarget("doctor")] : []),
      ...(installed && existsSync(join(this.cwd, SHARED_SKILLS_DIR))
        ? [atTarget("skills add")]
        : []),
    ];
    const actions = plan.cliBehind
      ? [
          `This CLI is still ${this.cliVersion}. Run the newest with ${newestCliCommand("<command>", this.cliVersion)}, or if you installed it globally, update it with npm install --global ${ZITADEL.cliPackage}@${plan.target}.`,
        ]
      : [];

    const rows = report.rows();
    return this.emit({
      status: "ok",
      data: report.data(),
      pretty: painted([strong(report.title), ...rows].join("\n")),
      summary: {
        title: report.title,
        sections: [],
        lines: rows,
      },
      next: {
        ...(actions.length > 0 ? { actions } : {}),
        ...(commands.length > 0 ? { commands } : {}),
      },
    });
  }
}

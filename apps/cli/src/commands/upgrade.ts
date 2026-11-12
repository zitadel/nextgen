import { existsSync } from "node:fs";
import { join } from "node:path";

import { execa } from "execa";

import { Cmd } from "@/lib/cmd";
import { errorMessage, ZitadelError } from "@/lib/errors";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { painted } from "@/lib/oclif/rendering";
import { Suggestible } from "@/lib/oclif/suggestible";
import { hasZitadelConfig } from "@/lib/project";
import { newestCliCommand } from "@/lib/public-cli";
import { type BreakingChange, breakingChanges, RELEASE_NOTES_URL } from "@/lib/release-notes";
import { SHARED_SKILLS_DIR } from "@/lib/skills/add";
import { arrow, command, dim, mark, strong, url } from "@/lib/style";
import { type SuggestedCommand, shellCommand, unscopedCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import {
  InstallError,
  PackageInstaller,
  ReleaseLookupError,
  type UpgradePlan,
  type UpgradeResult,
  Upgrader,
} from "@/lib/upgrade";
import {
  UPDATE_CHECK_VARIABLE,
  ZITADEL_CLI,
  ZITADEL_SCOPE,
  zitadelChannel,
} from "@/lib/zitadel-packages";

const DOCTOR_TIMEOUT_MS = 5 * 60 * 1000;

/** How rerunning `doctor --fix` at the new version ended, when it ran at all. */
type Refresh = "done" | "issues" | "failed" | "planned" | "skipped";

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
    const upgrader = this.upgrader(flags.cwd);
    const plan = await this.planned(upgrader);
    const breaking = plan.upToDate ? [] : await breakingChanges(plan.oldest, plan.target);

    // Before anything changes, so the person reads it while they can still stop.
    if (!plan.upToDate) {
      this.log(this.banner(breaking));
    }
    const result = await this.applied(upgrader, plan);
    const refresh = await this.refreshed(plan, result, flags.telemetry === false);

    const title = this.title(plan);
    const rows = this.rows(plan, result, refresh);
    return this.emit({
      status: "ok",
      data: this.data({ plan, result, refresh, breaking, title }),
      pretty: painted([strong(title), ...rows].join("\n")),
      summary: { title, sections: [], lines: rows },
      next: this.next(plan, result, refresh, flags.cwd),
    });
  }

  /** What moves the project's packages, with Zitadel's settings. */
  private upgrader(typedCwd: string | undefined): Upgrader {
    return new Upgrader({
      cliVersion: this.cliVersion,
      cwd: this.cwd,
      scope: ZITADEL_SCOPE,
      dryRun: this.dryRun,
      channel: zitadelChannel(this.cliVersion, this.env),
      installer: new PackageInstaller({
        cwd: this.cwd,
        typedCwd,
        redirectStdoutToStderr: this.isJson,
      }),
    });
  }

  /** Decides what would change, refusing when the latest release cannot be looked up. */
  private async planned(upgrader: Upgrader): Promise<UpgradePlan> {
    try {
      return await upgrader.plan();
    } catch (error) {
      if (!(error instanceof ReleaseLookupError)) {
        throw error;
      }
      throw new ZitadelError("E_NETWORK", "Could not look up the latest Zitadel release", {
        hint: "Check the connection to the npm registry, then rerun.",
        nextCommands: [this.suggest("upgrade")],
      });
    }
  }

  /** Installs the new packages, refusing when the package manager fails. */
  private async applied(upgrader: Upgrader, plan: UpgradePlan): Promise<UpgradeResult> {
    try {
      return await upgrader.apply(plan);
    } catch (error) {
      if (!(error instanceof InstallError)) {
        throw error;
      }
      throw new ZitadelError("E_VALIDATION", "Could not install the new packages", {
        hint: `${errorMessage(error.cause)}. Nothing else changed; fix that and rerun.`,
        nextCommands: [shellCommand(error.command), this.suggest("upgrade")],
      });
    }
  }

  /** Has the new release regenerate the project's files, when something moved. */
  private async refreshed(
    plan: UpgradePlan,
    result: UpgradeResult,
    noTelemetry: boolean,
  ): Promise<Refresh> {
    if (result.installCommand === undefined || !(await hasZitadelConfig(this.cwd))) {
      return "skipped";
    }
    return this.dryRun ? "planned" : this.doctor(plan.target, noTelemetry);
  }

  /**
   * Runs the new release's `doctor --fix`, because only that release knows what
   * it generates. As a child, its one envelope captured: it must not print into
   * this command's output. A run that reports issues still repaired what it could.
   *
   * @throws The signal's reason when the run was interrupted.
   */
  private async doctor(version: string, noTelemetry: boolean): Promise<Refresh> {
    try {
      const result = await execa("npx", this.doctorArguments(version, noTelemetry), {
        cwd: this.cwd,
        env: { ...this.env, [UPDATE_CHECK_VARIABLE]: "0" },
        extendEnv: false,
        reject: false,
        stdin: "ignore",
        timeout: DOCTOR_TIMEOUT_MS,
        cancelSignal: this.signal,
      });
      this.signal.throwIfAborted();
      const envelope = JSON.parse(result.stdout) as { status?: unknown };
      return envelope.status === "ok" ? "done" : "issues";
    } catch {
      this.signal.throwIfAborted();
      return "failed";
    }
  }

  /** The arguments that run `doctor --fix` at a release without asking anything. */
  private doctorArguments(version: string, noTelemetry: boolean): string[] {
    const args = [
      "--yes",
      `${ZITADEL_CLI}@${version}`,
      "doctor",
      "--fix",
      "--non-interactive",
      "--json",
    ];
    return noTelemetry ? [...args, "--no-telemetry"] : args;
  }

  /** The breaking changes the upgrade crosses, then where to read the release notes. */
  private banner(breaking: readonly BreakingChange[]): string {
    const notes = breaking.map(({ version, note }) => {
      return `  ${mark.warn} ${strong(escapeControlCharacters(version))}  ${escapeControlCharacters(note)}`;
    });
    const heading = notes.length > 0 ? [strong("Breaking changes on the way:"), ...notes] : [];
    return [...heading, `Release notes: ${url(RELEASE_NOTES_URL)}`, ""].join("\n");
  }

  /** The headline, the one sentence every rendering draws. */
  private title(plan: UpgradePlan): string {
    const suffix = this.dryRun ? " (dry run)" : "";
    if (plan.upToDate) {
      return `Zitadel is up to date at ${plan.target}${suffix}`;
    }
    if (this.dryRun) {
      return `Zitadel can be upgraded to ${plan.target}${suffix}`;
    }
    return `Zitadel upgraded to ${plan.target}`;
  }

  /** The lines under the headline. */
  private rows(plan: UpgradePlan, result: UpgradeResult, refresh: Refresh): readonly string[] {
    return [
      ...this.packageRows(plan),
      ...this.installRows(result),
      ...this.refreshRows(refresh),
      ...this.leftAloneRows(plan),
    ];
  }

  /** One line for each package that moves. */
  private packageRows(plan: UpgradePlan): readonly string[] {
    const done = this.dryRun ? arrow : mark.pass;
    // A package's name and versions are what the registry answered, so they are
    // spelled out here rather than by whatever prints the report.
    return plan.packages.map((pkg) => {
      return `  ${done} ${escapeControlCharacters(`${pkg.name} ${pkg.from} → ${pkg.to}`)}`;
    });
  }

  /** What would run, on a dry run. */
  private installRows(result: UpgradeResult): readonly string[] {
    if (!this.dryRun || result.installCommand === undefined) {
      return [];
    }
    return [`  Would run ${command(result.installCommand)}`];
  }

  /** How regenerating the project's files ended. */
  private refreshRows(refresh: Refresh): readonly string[] {
    const done = this.dryRun ? arrow : mark.pass;
    switch (refresh) {
      case "done":
        return [`  ${done} Refreshed generated files with doctor --fix`];
      case "issues":
        return [`  ${mark.warn} Refreshed generated files; doctor still reports issues`];
      case "failed":
        return [`  ${mark.warn} Could not refresh generated files`];
      default:
        return [];
    }
  }

  /** The dependencies that are not exact pins, which are left alone. */
  private leftAloneRows(plan: UpgradePlan): readonly string[] {
    return plan.leftAlone.map((dependency) => {
      const said = `- ${dependency.name} left at "${dependency.specifier}", not an exact version`;
      return `  ${dim(escapeControlCharacters(said))}`;
    });
  }

  /** The envelope's `data`. */
  private data(run: {
    plan: UpgradePlan;
    result: UpgradeResult;
    refresh: Refresh;
    breaking: readonly BreakingChange[];
    title: string;
  }): Record<string, unknown> {
    const { plan, result, refresh, breaking, title } = run;
    return {
      title,
      ...(this.dryRun ? { dry_run: true } : {}),
      current_version: plan.cliVersion,
      latest_version: plan.target,
      up_to_date: plan.upToDate,
      packages: plan.packages,
      left_alone: plan.leftAlone.map(({ name, specifier }) => {
        return { name, specifier };
      }),
      breaking_changes: breaking,
      release_notes_url: RELEASE_NOTES_URL,
      refresh,
      ...(result.installCommand === undefined ? {} : { install_command: result.installCommand }),
    };
  }

  /** What to do next, and the commands to do it with. */
  private next(
    plan: UpgradePlan,
    result: UpgradeResult,
    refresh: Refresh,
    typedCwd: string | undefined,
  ) {
    // At the new version, and from the shell's directory like every suggestion.
    const atTarget = (args: string): SuggestedCommand => {
      return unscopedCommand(
        typedCwd === undefined ? args : `${args} ${Cmd.option("--cwd", typedCwd)}`,
        plan.target,
      );
    };
    const commands: SuggestedCommand[] = [
      ...(this.dryRun && !plan.upToDate ? [this.suggest("upgrade")] : []),
      ...(refresh === "failed" ? [atTarget("doctor --fix")] : []),
      ...(refresh === "issues" ? [atTarget("doctor")] : []),
      ...(result.installed && existsSync(join(this.cwd, SHARED_SKILLS_DIR))
        ? [atTarget("skills add")]
        : []),
    ];
    const actions = plan.cliBehind
      ? [
          `This CLI is still ${this.cliVersion}. Run the newest with ${newestCliCommand("<command>", this.cliVersion)}, or if you installed it globally, update it with npm install --global ${ZITADEL_CLI}@${plan.target}.`,
        ]
      : [];
    return {
      ...(actions.length > 0 ? { actions } : {}),
      ...(commands.length > 0 ? { commands } : {}),
    };
  }
}

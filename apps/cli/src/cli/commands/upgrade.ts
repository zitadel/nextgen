import { existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";

import { errorMessage, ZitadelError } from "@/lib/errors";
import { CommandGroups } from "@/cli/commands/groups";
import type { Admitted, CommandResult } from "@/cli/core";
import { painted } from "@/lib/oclif/rendering";
import { Skills } from "@/lib/skills";
import { style } from "@/lib/ui";
import { Spelling, type SuggestedCommand, suggestedCommandOf } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { releaseChannel } from "@/lib/upgrade/config";
import { UPDATE_CHECK_VARIABLE, ZITADEL_SCOPE } from "@/lib/upgrade/defaults";
import {
  type BreakingChange,
  CliPackage,
  InstallError,
  PackageInstaller,
  ReleaseLookupError,
  ReleaseNotes,
  Upgrader,
  type UpgradeResult,
} from "@/lib/upgrade";
import { Project } from "@/lib/project";
import { Previewable } from "@/cli/core/previewable";
import { BaseCommand } from "@/cli/core";

/**
 * How long the new release's `doctor --fix` may run before it counts as failed.
 */
const DOCTOR_TIMEOUT_MS = 5 * 60 * 1000;

/** What the upgrader planned: the packages to move and the release they move to. */
type Plan = Awaited<ReturnType<Upgrader["plan"]>>;

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
export default class Upgrade extends Previewable(BaseCommand) {
  static override description =
    "Upgrade this project to the latest Zitadel release.\n\nRe-pins the project's exactly-pinned @zitadel/* packages with its own package manager, then runs the new release's doctor --fix to refresh generated files. Run it as npx @zitadel/cli@latest upgrade so the newest release does the upgrading.";
  static override group = CommandGroups.projectSettings;
  static override groupOrder = 5;

  static override examples = ["<%= config.bin %> upgrade", "<%= config.bin %> upgrade --dry-run"];

  /**
   * Upgrades the project in four steps, in an order that lets a person stop:
   *
   * 1. Plan, which only looks. A lookup that fails refuses here, before anything
   *    is touched.
   * 2. Print the breaking changes the upgrade crosses, before anything changes,
   *    so the person reads them while they can still stop.
   * 3. Install the new packages. A package manager that fails refuses here, and
   *    nothing else has changed.
   * 4. Regenerate the project's files with the new release's `doctor --fix`.
   *
   * What the person reads is built last, from what happened. A package's name and
   * versions are what the registry answered, so each is spelled out where it is
   * drawn, and every suggested command is built for the new release and run from
   * the directory the person typed.
   *
   * @param input - The parsed input, of which only the flags are read.
   * @returns The result, which is also the `--json` envelope.
   * @throws A `ZitadelError` `E_NETWORK` when the latest release cannot be looked
   * up, and `E_VALIDATION` when the install fails.
   */
  protected async preview({ flags }: Admitted<typeof Upgrade>): Promise<CommandResult> {
    const upgrader = new Upgrader({
      cliVersion: this.cliVersion,
      cwd: this.cwd,
      scope: ZITADEL_SCOPE,
      dryRun: true,
      channel: releaseChannel(this.cliVersion, this.env),
      installer: new PackageInstaller({
        cwd: this.cwd,
        typedCwd: flags.cwd,
      }),
    });
    const { plan, breaking, notes } = await this.planned(upgrader);
    const result = await upgrader.apply(plan);
    const refresh =
      result.installCommand === undefined || !(await Project.at(this.cwd).hasConfig())
        ? "skipped"
        : "planned";

    const rows = [
      ...plan.packages.map((pkg) => {
        return `  ${style.arrow} ${escapeControlCharacters(`${pkg.name} ${pkg.from} → ${pkg.to}`)}`;
      }),
      ...(result.installCommand === undefined
        ? []
        : [`  Would run ${style.command(result.installCommand)}`]),
      ...plan.leftAlone.map(({ name, specifier }) => {
        const said = `- ${name} left at "${specifier}", not an exact version`;

        return `  ${style.dim(escapeControlCharacters(said))}`;
      }),
    ];

    const verdict = plan.upToDate
      ? `Zitadel is up to date at ${plan.target}`
      : `Zitadel can be upgraded to ${plan.target}`;
    const title = `${verdict} (dry run)`;

    const commands: SuggestedCommand[] = plan.upToDate ? [] : [await this.realRun()];

    const actions = this.actions(plan);

    return {
      status: "ok",
      data: {
        title,
        dry_run: true,
        current_version: plan.cliVersion,
        latest_version: plan.target,
        up_to_date: plan.upToDate,
        packages: plan.packages,
        left_alone: plan.leftAlone.map(({ name, specifier }) => {
          return {
            name,
            specifier,
          };
        }),
        breaking_changes: breaking,
        release_notes_url: notes.url,
        refresh,
        ...(result.installCommand === undefined ? {} : { install_command: result.installCommand }),
      },
      pretty: painted([style.strong(title), ...rows].join("\n")),
      summary: {
        title,
        sections: [],
        lines: rows,
      },
      next: {
        ...(actions.length > 0 ? { actions } : {}),
        ...(commands.length > 0 ? { commands } : {}),
      },
    };
  }

  /**
   * Does what the command is for.
   *
   * @param input - The flags and arguments the command accepts.
   * @returns The envelope of the run.
   */
  protected async apply({ flags }: Admitted<typeof Upgrade>): Promise<CommandResult> {
    const upgrader = new Upgrader({
      cliVersion: this.cliVersion,
      cwd: this.cwd,
      scope: ZITADEL_SCOPE,
      dryRun: false,
      channel: releaseChannel(this.cliVersion, this.env),
      installer: new PackageInstaller({
        cwd: this.cwd,
        typedCwd: flags.cwd,
      }),
    });
    const { plan, breaking, notes } = await this.planned(upgrader);

    const result = await upgrader.apply(plan).catch(async (error: unknown) => {
      if (!(error instanceof InstallError)) {
        throw error;
      }
      throw new ZitadelError("E_VALIDATION", "Could not install the new packages", {
        hint: `${errorMessage(error.cause)}. Nothing else changed; fix that and rerun.`,
        nextCommands: [suggestedCommandOf(error.command), await this.again("upgrade", {})],
      });
    });

    const refresh = await this.refresh(plan.target, result, flags.telemetry === false);

    const refreshed = {
      done: [`  ${style.mark.pass} Refreshed generated files with doctor --fix`],
      issues: [`  ${style.mark.warn} Refreshed generated files; doctor still reports issues`],
      failed: [`  ${style.mark.warn} Could not refresh generated files`],
    };
    const rows = [
      ...plan.packages.map((pkg) => {
        return `  ${style.mark.pass} ${escapeControlCharacters(`${pkg.name} ${pkg.from} → ${pkg.to}`)}`;
      }),
      ...(refresh === "done" || refresh === "issues" || refresh === "failed"
        ? refreshed[refresh]
        : []),
      ...plan.leftAlone.map(({ name, specifier }) => {
        const said = `- ${name} left at "${specifier}", not an exact version`;

        return `  ${style.dim(escapeControlCharacters(said))}`;
      }),
    ];

    const title = plan.upToDate
      ? `Zitadel is up to date at ${plan.target}`
      : `Zitadel upgraded to ${plan.target}`;

    const atTarget = this.suggestWith(this.scope(), plan.target);
    const commands: SuggestedCommand[] = [];
    if (refresh === "failed") {
      commands.push(
        atTarget({
          id: "doctor",
          flags: { fix: true },
        }),
      );
    }
    if (refresh === "issues") {
      commands.push(atTarget({ id: "doctor" }));
    }
    if (result.installed && existsSync(join(this.cwd, Skills.SHARED_DIR))) {
      commands.push(atTarget({ id: "skills:add" }));
    }

    const actions = this.actions(plan);

    return {
      status: "ok",
      data: {
        title,
        current_version: plan.cliVersion,
        latest_version: plan.target,
        up_to_date: plan.upToDate,
        packages: plan.packages,
        left_alone: plan.leftAlone.map(({ name, specifier }) => {
          return {
            name,
            specifier,
          };
        }),
        breaking_changes: breaking,
        release_notes_url: notes.url,
        refresh,
        ...(result.installCommand === undefined ? {} : { install_command: result.installCommand }),
      },
      pretty: painted([style.strong(title), ...rows].join("\n")),
      summary: {
        title,
        sections: [],
        lines: rows,
      },
      next: {
        ...(actions.length > 0 ? { actions } : {}),
        ...(commands.length > 0 ? { commands } : {}),
      },
    };
  }

  /**
   * Looks up the release to upgrade to and prints the breaking changes the
   * upgrade crosses, before anything changes, so the person reads them while
   * they can still stop. A lookup that fails refuses here.
   *
   * @param upgrader - The upgrader the run plans with.
   * @returns The plan, the breaking changes it crosses and the release notes.
   * @throws A `ZitadelError` `E_NETWORK` when the latest release cannot be looked up.
   */
  private async planned(
    upgrader: Upgrader,
  ): Promise<{ plan: Plan; breaking: readonly BreakingChange[]; notes: ReleaseNotes }> {
    const plan = await upgrader.plan().catch(async (error: unknown) => {
      if (!(error instanceof ReleaseLookupError)) {
        throw error;
      }
      throw new ZitadelError("E_NETWORK", "Could not look up the latest Zitadel release", {
        hint: "Check the connection to the npm registry, and that it serves this release's dist-tag, then rerun.",
        nextCommands: [await this.again("upgrade", {})],
      });
    });

    const notes = new ReleaseNotes();
    const breaking: readonly BreakingChange[] = plan.upToDate
      ? []
      : await notes.breakingBetween(plan.oldest, plan.target);
    if (!plan.upToDate) {
      const banner = [
        ...(breaking.length > 0 ? [style.strong("Breaking changes on the way:")] : []),
        ...breaking.map(({ version, note }) => {
          const said = `${style.strong(escapeControlCharacters(version))}  ${escapeControlCharacters(note)}`;

          return `  ${style.mark.warn} ${said}`;
        }),
        `Release notes: ${style.url(notes.url)}`,
        "",
      ];
      this.log(banner.join("\n"));
    }

    return {
      plan,
      breaking,
      notes,
    };
  }

  /**
   * What the person is told to do outside this run: update the CLI that ran
   * the upgrade when it is behind the release it upgraded to.
   *
   * @param plan - The plan of the run.
   * @returns The steps, none when the CLI is current.
   */
  private actions(plan: Plan): string[] {
    if (!plan.cliBehind) {
      return [];
    }
    const newest = Spelling.at(this.cliVersion).newestCommand("<command>");
    const global = `npm install --global ${CliPackage.NAME}@${plan.target}`;

    return [
      `This CLI is still ${this.cliVersion}. Run the newest with ${newest}, or if you installed it globally, update it with ${global}.`,
    ];
  }

  /**
   * Has the new release regenerate the project's files with its own
   * `doctor --fix`, because only that release knows what it generates.
   *
   * It runs as a child whose one envelope is captured, because it must not print
   * into this command's output, and with an environment that keeps it off the
   * registry. A run that reports issues still repaired what it could, so the
   * outcome says so rather than failing; the new packages stay either way.
   * `--no-telemetry` reaches this run only, so it is passed on to the child.
   * An interruption ends the child and the upgrade with it, instead of counting
   * as a refresh that merely failed.
   *
   * @param version - The release whose `doctor --fix` is run.
   * @param result - What the install did.
   * @param noTelemetry - Whether `--no-telemetry` was given.
   * @returns `skipped` when nothing moved or the project has no Zitadel config,
   * `planned` on a dry run, and otherwise how the run ended.
   * @throws The signal's reason when the run was interrupted.
   */
  private async refresh(
    version: string,
    result: UpgradeResult,
    noTelemetry: boolean,
  ): Promise<"done" | "issues" | "failed" | "planned" | "skipped"> {
    if (result.installCommand === undefined || !(await Project.at(this.cwd).hasConfig())) {
      return "skipped";
    }

    const args = [
      "--yes",
      `${CliPackage.NAME}@${version}`,
      "doctor",
      "--fix",
      "--non-interactive",
      "--json",
    ];
    if (noTelemetry) {
      args.push("--no-telemetry");
    }
    try {
      const child = await execa("npx", args, {
        cwd: this.cwd,
        env: {
          ...this.env,
          [UPDATE_CHECK_VARIABLE]: "0",
        },
        extendEnv: false,
        reject: false,
        stdin: "ignore",
        timeout: DOCTOR_TIMEOUT_MS,
        cancelSignal: this.signal,
      });
      this.signal.throwIfAborted();
      const envelope = JSON.parse(child.stdout) as { status?: unknown };
      if (envelope.status === "ok") {
        return "done";
      }
      return "issues";
    } catch {
      this.signal.throwIfAborted();
      return "failed";
    }
  }
}

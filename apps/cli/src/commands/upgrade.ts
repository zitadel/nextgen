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
import { breakingChanges, RELEASE_NOTES_URL } from "@/lib/release-notes";
import { SHARED_SKILLS_DIR } from "@/lib/skills/add";
import { arrow, command, dim, mark, strong, url } from "@/lib/style";
import { type SuggestedCommand, shellCommand, unscopedCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import {
  InstallError,
  PackageInstaller,
  ReleaseLookupError,
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
    const upgrader = new Upgrader({
      cliVersion: this.cliVersion,
      cwd: this.cwd,
      scope: ZITADEL_SCOPE,
      dryRun: this.dryRun,
      channel: zitadelChannel(this.cliVersion, this.env),
      installer: new PackageInstaller({
        cwd: this.cwd,
        typedCwd: flags.cwd,
        redirectStdoutToStderr: this.isJson,
      }),
    });
    const plan = await upgrader.plan().catch((error: unknown) => {
      if (!(error instanceof ReleaseLookupError)) {
        throw error;
      }
      throw new ZitadelError("E_NETWORK", "Could not look up the latest Zitadel release", {
        hint: "Check the connection to the npm registry, then rerun.",
        nextCommands: [this.suggest("upgrade")],
      });
    });
    const breaking = plan.upToDate ? [] : await breakingChanges(plan.oldest, plan.target);

    // Before anything changes, so the person reads it while they can still stop.
    if (!plan.upToDate) {
      const notes = breaking.map(({ version, note }) => {
        return `  ${mark.warn} ${strong(escapeControlCharacters(version))}  ${escapeControlCharacters(note)}`;
      });
      const heading = notes.length > 0 ? [strong("Breaking changes on the way:"), ...notes] : [];
      this.log([...heading, `Release notes: ${url(RELEASE_NOTES_URL)}`, ""].join("\n"));
    }
    const result = await upgrader.apply(plan).catch((error: unknown) => {
      if (!(error instanceof InstallError)) {
        throw error;
      }
      throw new ZitadelError("E_VALIDATION", "Could not install the new packages", {
        hint: `${errorMessage(error.cause)}. Nothing else changed; fix that and rerun.`,
        nextCommands: [shellCommand(error.command), this.suggest("upgrade")],
      });
    });
    const refresh = await this.refresh(plan.target, result, flags.telemetry === false);

    const done = this.dryRun ? arrow : mark.pass;
    const refreshLines: Partial<Record<Refresh, string>> = {
      done: `  ${done} Refreshed generated files with doctor --fix`,
      issues: `  ${mark.warn} Refreshed generated files; doctor still reports issues`,
      failed: `  ${mark.warn} Could not refresh generated files`,
    };
    const refreshLine = refreshLines[refresh];
    const rows = [
      // A package's name and versions are what the registry answered, so they are
      // spelled out here rather than by whatever prints the report.
      ...plan.packages.map((pkg) => {
        return `  ${done} ${escapeControlCharacters(`${pkg.name} ${pkg.from} → ${pkg.to}`)}`;
      }),
      ...(this.dryRun && result.installCommand !== undefined
        ? [`  Would run ${command(result.installCommand)}`]
        : []),
      ...(refreshLine === undefined ? [] : [refreshLine]),
      ...plan.leftAlone.map(({ name, specifier }) => {
        const said = `- ${name} left at "${specifier}", not an exact version`;
        return `  ${dim(escapeControlCharacters(said))}`;
      }),
    ];
    const moves = this.dryRun ? "can be upgraded to" : "upgraded to";
    const verb = plan.upToDate ? "is up to date at" : moves;
    const title = `Zitadel ${verb} ${plan.target}${this.dryRun ? " (dry run)" : ""}`;

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
      ...(result.installed && existsSync(join(this.cwd, SHARED_SKILLS_DIR))
        ? [atTarget("skills add")]
        : []),
    ];
    const actions = plan.cliBehind
      ? [
          `This CLI is still ${this.cliVersion}. Run the newest with ${newestCliCommand("<command>", this.cliVersion)}, or if you installed it globally, update it with npm install --global ${ZITADEL_CLI}@${plan.target}.`,
        ]
      : [];

    return this.emit({
      status: "ok",
      data: {
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
      },
      pretty: painted([strong(title), ...rows].join("\n")),
      summary: { title, sections: [], lines: rows },
      next: {
        ...(actions.length > 0 ? { actions } : {}),
        ...(commands.length > 0 ? { commands } : {}),
      },
    });
  }

  /**
   * Has the new release regenerate the project's files: its `doctor --fix`,
   * because only that release knows what it generates. As a child, its one
   * envelope captured: it must not print into this command's output. A run that
   * reports issues still repaired what it could.
   *
   * @returns `skipped` when nothing moved or the project has no Zitadel config,
   * `planned` on a dry run, else how the run ended.
   * @throws The signal's reason when the run was interrupted.
   */
  private async refresh(
    version: string,
    result: UpgradeResult,
    noTelemetry: boolean,
  ): Promise<Refresh> {
    if (result.installCommand === undefined || !(await hasZitadelConfig(this.cwd))) {
      return "skipped";
    }
    if (this.dryRun) {
      return "planned";
    }
    const args = [
      "--yes",
      `${ZITADEL_CLI}@${version}`,
      "doctor",
      "--fix",
      "--non-interactive",
      "--json",
    ];
    try {
      const child = await execa("npx", noTelemetry ? [...args, "--no-telemetry"] : args, {
        cwd: this.cwd,
        env: { ...this.env, [UPDATE_CHECK_VARIABLE]: "0" },
        extendEnv: false,
        reject: false,
        stdin: "ignore",
        timeout: DOCTOR_TIMEOUT_MS,
        cancelSignal: this.signal,
      });
      this.signal.throwIfAborted();
      const envelope = JSON.parse(child.stdout) as { status?: unknown };
      return envelope.status === "ok" ? "done" : "issues";
    } catch {
      this.signal.throwIfAborted();
      return "failed";
    }
  }
}

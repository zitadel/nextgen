import { existsSync } from "node:fs";
import { join } from "node:path";

import { execa } from "execa";

import { errorMessage, ZitadelError } from "@/lib/errors";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { painted } from "@/lib/oclif/rendering";
import { hasZitadelConfig } from "@/lib/project";
import { newestCliCommand } from "@/lib/public-cli";
import { type BreakingChange, breakingChanges, RELEASE_NOTES_URL } from "@/lib/release-notes";
import { SHARED_SKILLS_DIR } from "@/lib/skills/add";
import { arrow, command, dim, mark, strong, url } from "@/lib/style";
import { type SuggestedCommand, shellCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import {
  InstallError,
  PackageInstaller,
  ReleaseLookupError,
  type UpgradeResult,
  Upgrader,
} from "@/lib/upgrade";
import { UPDATE_CHECK_VARIABLE, ZITADEL_CLI, ZITADEL_SCOPE } from "@/cli/constants";
import { zitadelChannel } from "@/cli/release";

/**
 * How long the new release's `doctor --fix` may run before it counts as failed.
 */
const DOCTOR_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * How rerunning `doctor --fix` at the new version ended, when it ran at all.
 */
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
export default class Upgrade extends BaseCommand {
  static override description =
    "Upgrade this project to the latest Zitadel release.\n\nRe-pins the project's exactly-pinned @zitadel/* packages with its own package manager, then runs the new release's doctor --fix to refresh generated files. Run it as npx @zitadel/cli@latest upgrade so the newest release does the upgrading.";
  static override group = CommandGroups.diagnostics;
  static override groupOrder = 2;

  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --dry-run",
  ];

  /**
   * Everything this command does is about npm and the project, so there is no
   * server to ask.
   */
  static override meta = {
    resolveServer: false,
  };

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

    const plan = await upgrader.plan().catch(async (error: unknown) => {
      if (!(error instanceof ReleaseLookupError)) {
        throw error;
      }
      throw new ZitadelError("E_NETWORK", "Could not look up the latest Zitadel release", {
        hint: "Check the connection to the npm registry, then rerun.",
        nextCommands: [await this.again("upgrade", {})],
      });
    });

    let breaking: readonly BreakingChange[] = [];
    if (!plan.upToDate) {
      breaking = await breakingChanges(plan.oldest, plan.target);
      const banner: string[] = [];
      if (breaking.length > 0) {
        banner.push(strong("Breaking changes on the way:"));
      }
      for (const { version, note } of breaking) {
        const said = `${strong(escapeControlCharacters(version))}  ${escapeControlCharacters(note)}`;
        banner.push(`  ${mark.warn} ${said}`);
      }
      banner.push(`Release notes: ${url(RELEASE_NOTES_URL)}`, "");
      this.log(banner.join("\n"));
    }

    const result = await upgrader.apply(plan).catch(async (error: unknown) => {
      if (!(error instanceof InstallError)) {
        throw error;
      }
      throw new ZitadelError("E_VALIDATION", "Could not install the new packages", {
        hint: `${errorMessage(error.cause)}. Nothing else changed; fix that and rerun.`,
        nextCommands: [shellCommand(error.command), await this.again("upgrade", {})],
      });
    });

    const refresh = await this.refresh(plan.target, result, flags.telemetry === false);

    let done = mark.pass;
    if (this.dryRun) {
      done = arrow;
    }
    const rows: string[] = [];
    for (const pkg of plan.packages) {
      const said = escapeControlCharacters(`${pkg.name} ${pkg.from} → ${pkg.to}`);
      rows.push(`  ${done} ${said}`);
    }
    if (this.dryRun && result.installCommand !== undefined) {
      rows.push(`  Would run ${command(result.installCommand)}`);
    }
    if (refresh === "done") {
      rows.push(`  ${done} Refreshed generated files with doctor --fix`);
    } else if (refresh === "issues") {
      rows.push(`  ${mark.warn} Refreshed generated files; doctor still reports issues`);
    } else if (refresh === "failed") {
      rows.push(`  ${mark.warn} Could not refresh generated files`);
    }
    for (const { name, specifier } of plan.leftAlone) {
      const said = `- ${name} left at "${specifier}", not an exact version`;
      rows.push(`  ${dim(escapeControlCharacters(said))}`);
    }

    let title = `Zitadel upgraded to ${plan.target}`;
    if (plan.upToDate) {
      title = `Zitadel is up to date at ${plan.target}`;
    } else if (this.dryRun) {
      title = `Zitadel can be upgraded to ${plan.target}`;
    }
    if (this.dryRun) {
      title = `${title} (dry run)`;
    }

    const atTarget = this.suggestWith(this.scope(), plan.target);
    const commands: SuggestedCommand[] = [];
    if (this.dryRun && !plan.upToDate) {
      commands.push(await this.realRun());
    }
    if (refresh === "failed") {
      commands.push(atTarget({ id: "doctor", flags: { fix: true } }));
    }
    if (refresh === "issues") {
      commands.push(atTarget({ id: "doctor" }));
    }
    if (result.installed && existsSync(join(this.cwd, SHARED_SKILLS_DIR))) {
      commands.push(atTarget({ id: "skills:add" }));
    }

    const actions: string[] = [];
    if (plan.cliBehind) {
      const newest = newestCliCommand("<command>", this.cliVersion);
      const global = `npm install --global ${ZITADEL_CLI}@${plan.target}`;
      actions.push(
        `This CLI is still ${this.cliVersion}. Run the newest with ${newest}, or if you installed it globally, update it with ${global}.`,
      );
    }

    const data: Record<string, unknown> = { title };
    if (this.dryRun) {
      data.dry_run = true;
    }
    Object.assign(data, {
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
      release_notes_url: RELEASE_NOTES_URL,
      refresh,
    });
    if (result.installCommand !== undefined) {
      data.install_command = result.installCommand;
    }

    const next: { actions?: string[]; commands?: SuggestedCommand[] } = {};
    if (actions.length > 0) {
      next.actions = actions;
    }
    if (commands.length > 0) {
      next.commands = commands;
    }

    return this.emit({
      status: "ok",
      data,
      pretty: painted([strong(title), ...rows].join("\n")),
      summary: {
        title,
        sections: [],
        lines: rows,
      },
      next,
    });
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

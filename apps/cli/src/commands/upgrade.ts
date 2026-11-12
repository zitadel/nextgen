import { existsSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import semver from "semver";

import { errorMessage, ZitadelError } from "@/lib/errors";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import { painted } from "@/lib/oclif/rendering";
import {
  addExactCommandFor,
  detectPackageManager,
  inDirectory,
  type PackageCommand,
  runPackageCommand,
} from "@/lib/package-manager";
import { hasZitadelConfig } from "@/lib/project";
import { newestCliCommand } from "@/lib/public-cli";
import { type BreakingChange, breakingChanges, RELEASE_NOTES_URL } from "@/lib/release-notes";
import { SHARED_SKILLS_DIR } from "@/lib/skills/add";
import { arrow, command, dim, mark, strong, url } from "@/lib/style";
import { type Suggest, type SuggestedCommand, shellCommand } from "@/lib/suggestion";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { isNewerVersion, latestCliVersion } from "@/lib/update-check";
import { exactZitadelPins, floatingZitadelSpecs } from "@/lib/zitadel-pins";

const REFRESH_TIMEOUT_MS = 5 * 60 * 1000;

/** How rerunning `doctor --fix` at the new version ended, when it ran at all. */
type Refresh = "done" | "issues" | "failed" | "planned" | "skipped";

type PackageUpgrade = { name: string; from: string; to: string };

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

  // Everything here is about npm and the project: nothing to ask a server.
  static override meta = {
    resolveServer: false,
  };

  protected async execute({ flags }: Admitted<typeof Upgrade>): Promise<JsonEnvelope> {
    const latest = await latestCliVersion({
      cliVersion: this.cliVersion,
      env: this.env,
      fresh: true,
    });
    if (latest === undefined) {
      throw new ZitadelError("E_NETWORK", "Could not look up the latest Zitadel release", {
        hint: "Check the connection to the npm registry, then rerun.",
        nextCommands: [this.suggest({ id: "upgrade" })],
      });
    }
    // A CLI ahead of the dist-tag (a prerelease) is what its own files target,
    // so it is never moved back.
    const target = isNewerVersion(latest, this.cliVersion) ? latest : this.cliVersion;
    const cliBehind = target !== this.cliVersion;
    const packages: PackageUpgrade[] = ((await exactZitadelPins(this.cwd)) ?? [])
      .filter(([, version]) => {
        return semver.lt(version, target);
      })
      .map(([name, version]) => {
        return {
          name,
          from: version,
          to: target,
        };
      });
    const leftAlone = (await floatingZitadelSpecs(this.cwd)) ?? [];
    const upToDate = !cliBehind && packages.length === 0;
    const breaking = upToDate
      ? []
      : await breakingChanges(
          oldestOf([
            this.cliVersion,
            ...packages.map((pkg) => {
              return pkg.from;
            }),
          ]),
          target,
        );

    // Before anything changes, so the person reads it while they can still stop.
    if (!upToDate) {
      this.log(renderBreakingChanges(breaking));
    }
    const install =
      packages.length === 0
        ? undefined
        : addExactCommandFor(
            await detectPackageManager(this.cwd),
            packages.map((pkg) => {
              return `${pkg.name}@${pkg.to}`;
            }),
          );
    const installSuggestion =
      install === undefined
        ? undefined
        : shellCommand(inDirectory(install, flags.cwd, this.cwd).display);
    if (install !== undefined && installSuggestion !== undefined && !this.dryRun) {
      await this.install(install, installSuggestion);
    }
    const refreshes = install !== undefined && (await hasZitadelConfig(this.cwd));
    let refresh: Refresh = "skipped";
    if (refreshes) {
      refresh = this.dryRun
        ? "planned"
        : await refreshProject(target, this.cwd, this.env, flags.telemetry === false, this.signal);
    }

    const commands: SuggestedCommand[] = [
      ...(this.dryRun && !upToDate ? [this.suggest({ id: "upgrade" })] : []),
      ...(refresh === "failed"
        ? [this.atTarget(target)({ id: "doctor", flags: { fix: true } })]
        : []),
      ...(refresh === "issues" ? [this.atTarget(target)({ id: "doctor" })] : []),
      ...(install !== undefined && !this.dryRun && existsSync(join(this.cwd, SHARED_SKILLS_DIR))
        ? [this.atTarget(target)({ id: "skills:add" })]
        : []),
    ];
    const actions = [
      ...(cliBehind
        ? [
            `This CLI is still ${this.cliVersion}. Run the newest with ${newestCliCommand("<command>", this.cliVersion)}, or if you installed it globally, update it with npm install --global @zitadel/cli@${target}.`,
          ]
        : []),
    ];

    let said = `Zitadel upgraded to ${target}`;
    if (upToDate) {
      said = `Zitadel is up to date at ${target}`;
    } else if (this.dryRun) {
      said = `Zitadel can be upgraded to ${target}`;
    }
    said = `${said}${this.dryRun ? " (dry run)" : ""}`;
    const done = this.dryRun ? arrow : mark.pass;
    const rows = [
      // A package's name and versions are what the registry answered, and this
      // line colours only the mark in front of them, so they are spelled out
      // here rather than by whatever prints the report.
      ...packages.map((pkg) => {
        return `  ${done} ${escapeControlCharacters(`${pkg.name} ${pkg.from} → ${pkg.to}`)}`;
      }),
      ...(this.dryRun && installSuggestion !== undefined
        ? [`  Would run ${command(installSuggestion)}`]
        : []),
      ...(refresh === "done" ? [`  ${done} Refreshed generated files with doctor --fix`] : []),
      ...(refresh === "issues"
        ? [`  ${mark.warn} Refreshed generated files; doctor still reports issues`]
        : []),
      ...(refresh === "failed" ? [`  ${mark.warn} Could not refresh generated files`] : []),
      ...leftAlone.map(([name, specifier]) => {
        return `  ${dim(escapeControlCharacters(`- ${name} left at "${specifier}", not an exact version`))}`;
      }),
    ];

    return this.emit({
      status: "ok",
      data: {
        title: said,
        ...(this.dryRun ? { dry_run: true } : {}),
        current_version: this.cliVersion,
        latest_version: target,
        up_to_date: upToDate,
        packages,
        left_alone: leftAlone.map(([name, specifier]) => {
          return {
            name,
            specifier,
          };
        }),
        breaking_changes: breaking,
        release_notes_url: RELEASE_NOTES_URL,
        refresh,
        ...(installSuggestion === undefined ? {} : { install_command: installSuggestion }),
      },
      pretty: painted([strong(said), ...rows].join("\n")),
      summary: {
        title: said,
        sections: [],
        lines: rows,
      },
      next: {
        ...(actions.length > 0 ? { actions } : {}),
        ...(commands.length > 0 ? { commands } : {}),
      },
    });
  }

  /**
   * A command to run at the new version, from the shell's directory like every
   * suggestion: the CLI's own `--cwd` goes back on, and the command is written
   * for `target` rather than for the release that is running.
   *
   * @param target - The release the command runs as.
   * @returns The renderer.
   */
  private atTarget(target: string): Suggest {
    return this.suggestWith(this.scope(), target);
  }

  private async install(install: PackageCommand, installCommand: SuggestedCommand): Promise<void> {
    try {
      await runPackageCommand(install, {
        cwd: this.cwd,
        // A package manager's progress would break the one envelope on stdout.
        redirectStdoutToStderr: this.isJson,
      });
    } catch (error) {
      throw new ZitadelError("E_VALIDATION", "Could not install the new packages", {
        hint: `${errorMessage(error)}. Nothing else changed; fix that and rerun.`,
        nextCommands: [installCommand, this.suggest({ id: "upgrade" })],
      });
    }
  }
}

function oldestOf(versions: readonly string[]): string {
  return [...versions].sort(semver.compare)[0] ?? "0.0.0";
}

/**
 * Runs the new release's `doctor --fix`, because only that release knows what it
 * generates. As a child, its one envelope captured: it must not print into this
 * command's output. It repairs and then verifies, so a run that reports issues
 * still repaired what it could, and those are for the person to look at; the new
 * packages stay either way.
 */
async function refreshProject(
  target: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  /** `--no-telemetry` was given: it reaches this run only, not the child, without being passed on. */
  noTelemetry: boolean,
  /** Ctrl-C: it ends the child and the upgrade with it, rather than a refresh that merely failed. */
  signal: AbortSignal,
): Promise<Refresh> {
  try {
    const result = await execa(
      "npx",
      [
        "--yes",
        `@zitadel/cli@${target}`,
        "doctor",
        "--fix",
        "--non-interactive",
        "--json",
        ...(noTelemetry ? ["--no-telemetry"] : []),
      ],
      {
        cwd,
        env: {
          ...env,
          ZITADEL_UPDATE_CHECK: "0",
        },
        extendEnv: false,
        reject: false,
        stdin: "ignore",
        timeout: REFRESH_TIMEOUT_MS,
        cancelSignal: signal,
      },
    );
    signal.throwIfAborted();
    const envelope = JSON.parse(result.stdout) as { status?: unknown };
    return envelope.status === "ok" ? "done" : "issues";
  } catch {
    signal.throwIfAborted();
    return "failed";
  }
}

function renderBreakingChanges(breaking: readonly BreakingChange[]): string {
  const notes = breaking.flatMap(({ version, note }) => {
    return [
      `  ${mark.warn} ${strong(escapeControlCharacters(version))}  ${escapeControlCharacters(note)}`,
    ];
  });
  return [
    ...(notes.length > 0 ? [strong("Breaking changes on the way:"), ...notes] : []),
    `Release notes: ${url(RELEASE_NOTES_URL)}`,
    "",
  ].join("\n");
}

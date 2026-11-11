import { existsSync } from "node:fs";
import { join } from "node:path";

import { execa } from "execa";
import semver from "semver";

import { ZitadelError, errorMessage } from "@/lib/errors";
import { type Admitted, BaseCommand, CommandGroups, type JsonEnvelope } from "@/lib/oclif";
import {
  addExactCommandFor,
  detectPackageManager,
  inDirectory,
  type PackageCommand,
  runPackageCommand,
} from "@/lib/package-manager";
import { Cmd } from "@/lib/cmd";
import { hasZitadelConfig } from "@/lib/project";
import { newestCliCommand } from "@/lib/public-cli";
import { type BreakingChange, breakingChanges, RELEASE_NOTES_URL } from "@/lib/release-notes";
import { SHARED_SKILLS_DIR } from "@/lib/skills/add";
import { arrow, command, dim, mark, strong, url } from "@/lib/style";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { painted } from "@/lib/oclif/rendering";
import { type SuggestedCommand, shellCommand, unscopedCommand } from "@/lib/suggestion";
import { isNewerVersion, latestCliVersion } from "@/lib/update-check";
import { exactZitadelPins, floatingZitadelSpecs } from "@/lib/zitadel-pins";

const REFRESH_TIMEOUT_MS = 5 * 60 * 1000;

/** How rerunning `doctor --fix` at the new version ended, when it ran at all. */
type Refresh = "done" | "issues" | "failed" | "skipped";

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
    const { cliVersion, cwd, dryRun, env } = this;

    const latest = await latestCliVersion({ cliVersion, env, fresh: true });
    if (latest === undefined) {
      throw new ZitadelError("E_NETWORK", "Could not look up the latest Zitadel release", {
        hint: "Check the connection to the npm registry, then rerun.",
        nextCommands: [this.suggestUnscoped("upgrade")],
      });
    }
    // A CLI ahead of the dist-tag (a prerelease) is what its own files target,
    // so it is never moved back.
    const target = isNewerVersion(latest, cliVersion) ? latest : cliVersion;
    const cliBehind = target !== cliVersion;
    const packages: PackageUpgrade[] = ((await exactZitadelPins(cwd)) ?? [])
      .filter(([, version]) => semver.lt(version, target))
      .map(([name, version]) => ({ name, from: version, to: target }));
    const leftAlone = (await floatingZitadelSpecs(cwd)) ?? [];
    const upToDate = !cliBehind && packages.length === 0;
    const breaking = upToDate
      ? []
      : await breakingChanges(oldestOf([cliVersion, ...packages.map((pkg) => pkg.from)]), target);

    // Before anything changes, so the person reads it while they can still stop.
    if (!upToDate) {
      this.log(renderBreakingChanges(breaking));
    }
    const install =
      packages.length === 0
        ? undefined
        : addExactCommandFor(
            await detectPackageManager(cwd),
            packages.map((pkg) => `${pkg.name}@${pkg.to}`),
          );
    const installSuggestion =
      install === undefined
        ? undefined
        : shellCommand(inDirectory(install, flags.cwd, cwd).display);
    if (install !== undefined && installSuggestion !== undefined && !dryRun) {
      await this.install(install, installSuggestion);
    }
    const refresh: Refresh =
      install !== undefined && !dryRun && (await hasZitadelConfig(cwd))
        ? await refreshProject(target, cwd, env, flags.telemetry === false)
        : "skipped";

    // At the new version, and from the shell's directory like every suggestion.
    const atTarget = (args: string): SuggestedCommand =>
      unscopedCommand(
        flags.cwd === undefined ? args : `${args} ${Cmd.option("--cwd", flags.cwd)}`,
        target,
      );
    const commands: SuggestedCommand[] = [
      ...(refresh === "failed" ? [atTarget("doctor --fix")] : []),
      ...(refresh === "issues" ? [atTarget("doctor")] : []),
      ...(install !== undefined && !dryRun && existsSync(join(cwd, SHARED_SKILLS_DIR))
        ? [atTarget("skills add")]
        : []),
    ];
    const actions = [
      ...(cliBehind
        ? [
            `This CLI is still ${cliVersion}. Run the newest with \`${newestCliCommand("<command>", cliVersion)}\`, or if you installed it globally, update it with \`npm install --global @zitadel/cli@${target}\`.`,
          ]
        : []),
    ];
    const next = {
      ...(actions.length > 0 ? { actions } : {}),
      ...(commands.length > 0 ? { commands } : {}),
    };

    const title = upToDate
      ? `Zitadel is up to date at ${target}.`
      : dryRun
        ? `Zitadel can be upgraded to ${target}.`
        : `Zitadel upgraded to ${target}.`;
    return this.emit({
      status: "ok",
      data: {
        title,
        current_version: cliVersion,
        latest_version: target,
        up_to_date: upToDate,
        packages,
        left_alone: leftAlone.map(([name, specifier]) => ({ name, specifier })),
        breaking_changes: breaking,
        release_notes_url: RELEASE_NOTES_URL,
        refresh,
        ...(installSuggestion === undefined ? {} : { install_command: installSuggestion }),
        ...(dryRun ? { dry_run: true } : {}),
      },
      next,
      // Painted, because the report is a coloured one the CLI drew; every
      // value it names was spelled out where it was read.
      pretty: painted(
        renderUpgrade({ title, packages, leftAlone, refresh, dryRun, installSuggestion }),
      ),
    });
  }

  private async install(install: PackageCommand, suggestion: SuggestedCommand): Promise<void> {
    try {
      await runPackageCommand(install, {
        cwd: this.cwd,
        // A package manager's progress would break the one envelope on stdout.
        redirectStdoutToStderr: this.jsonEnabled(),
      });
    } catch (error) {
      throw new ZitadelError("E_VALIDATION", "Could not install the new packages", {
        hint: `${errorMessage(error)}. Nothing else changed; fix that and rerun.`,
        nextCommands: [suggestion, this.suggestUnscoped("upgrade")],
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
        env: { ...env, ZITADEL_UPDATE_CHECK: "0" },
        extendEnv: false,
        reject: false,
        stdin: "ignore",
        timeout: REFRESH_TIMEOUT_MS,
      },
    );
    const envelope = JSON.parse(result.stdout) as { status?: unknown };
    return envelope.status === "ok" ? "done" : "issues";
  } catch {
    return "failed";
  }
}

function renderBreakingChanges(breaking: readonly BreakingChange[]): string {
  const notes = breaking.flatMap(({ version, note }) => [
    `  ${mark.warn} ${strong(version)}  ${note}`,
  ]);
  return [
    ...(notes.length > 0 ? [strong("Breaking changes on the way:"), ...notes] : []),
    `Release notes: ${url(RELEASE_NOTES_URL)}`,
    "",
  ].join("\n");
}

function renderUpgrade(input: {
  title: string;
  packages: readonly PackageUpgrade[];
  leftAlone: ReadonlyArray<readonly [string, string]>;
  refresh: Refresh;
  dryRun: boolean;
  installSuggestion: string | undefined;
}): string {
  const { title, packages, leftAlone, refresh, dryRun, installSuggestion } = input;
  const done = dryRun ? arrow : mark.pass;
  return [
    strong(title),
    // A package's name and versions are what the registry answered, and this
    // line colours only the mark in front of them, so they are spelled out
    // here rather than by whatever prints the report.
    ...packages.map((pkg) => {
      return `  ${done} ${escapeControlCharacters(`${pkg.name} ${pkg.from} → ${pkg.to}`)}`;
    }),
    ...(dryRun && installSuggestion !== undefined
      ? [`  Would run ${command(installSuggestion)}`]
      : []),
    ...(refresh === "done" ? [`  ${done} Refreshed generated files with doctor --fix`] : []),
    ...(refresh === "issues"
      ? [`  ${mark.warn} Refreshed generated files; doctor still reports issues`]
      : []),
    ...(refresh === "failed" ? [`  ${mark.warn} Could not refresh generated files`] : []),
    ...leftAlone.map(
      ([name, specifier]) => `  ${dim(`- ${name} left at "${specifier}", not an exact version`)}`,
    ),
  ].join("\n");
}

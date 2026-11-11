import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Flags } from "@oclif/core";
import { z } from "zod";

import { startedServer } from "@/commands/local-server/started";
import { createZitadelClient } from "@/lib/backend";
import { claimAction, claimCommand, claimWindowClosedAction } from "@/lib/claim-state";
import { Cmd } from "@/lib/cmd";
import { isRefusal } from "@/lib/consent";
import { resolveEnvironment } from "@/lib/environment";
import { errorMessage, ZitadelError } from "@/lib/errors";
import { serverLogAction } from "@/lib/journey-guidance";
import {
  dockerRuntimeGuidance,
  dockerUnavailableMessage,
} from "@/lib/local-server/docker-guidance";
import type { LocalServers, ManagedRuntimeProcess } from "@/lib/local-server/processes";
import {
  assertLocalStateWritable,
  checkLocalServerHealth,
  DEFAULT_LOCAL_SERVER_PORT,
  defaultLocalServerImageForCliVersion,
  findUpward,
  LOCAL_RUNTIME_FILE,
  localServerUrl,
  RUNTIME_BACKENDS,
  type RuntimeBackend,
  type RuntimeMetadata,
  readNearestRuntimeMetadata,
  resolveRuntimeBackend,
} from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import { log } from "@/lib/log";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import { Destructive } from "@/lib/oclif/destructive";
import {
  environmentFlags,
  environmentSelectorSuffix,
  projectEnvFile,
} from "@/lib/oclif/environment-flags";
import { type Refused, reads, whole } from "@/lib/oclif/flags";
import {
  asStepsShown,
  type NextSteps,
  nextStepsData,
  renderNextSteps,
  stepsOf,
} from "@/lib/oclif/next-steps";
import { createOrca } from "@/lib/orca";
import { listenersForPort } from "@/lib/prober/ports";
import {
  hasZitadelConfig,
  hasZitadelSecret,
  readProjectServer,
  readZitadelConfig,
  readZitadelSecret,
} from "@/lib/project";
import { isLoopbackUrl } from "@/lib/server";
import {
  type EnvironmentSelector,
  portableSuggestions,
  projectCommand,
  type SuggestedCommand,
  shellCommand,
  unscopedCommand,
} from "@/lib/suggestion";
import { userAgent } from "@/lib/user-agent";
import { reportWarning } from "@/lib/warnings";

import { type CheckContext, type CheckOutcome, checkCliVersion, SANITY_CHECKS } from "./checks";
import { doctorReport, renderDoctorReport, withCategories } from "./report";

const LOCAL_RUNTIME_CHECK_NAMES = new Set([
  "server-binary",
  "docker-cli",
  "image",
  "state-dir",
  "port",
  "runtime",
]);

/**
 * `zitadel doctor` — verify generated files and local state.
 *
 * Runs every registered {@link SANITY_CHECKS} entry and emits the aggregate
 * result; if any check fails it throws `E_VALIDATION` carrying the full check
 * details. With `--fix`, each check that did not pass — failed or warned —
 * first attempts its own repair (a no-op for checks with no safe automatic
 * remedy), then the battery re-runs.
 *
 * The `--fix` loop is best-effort: a repair that throws (e.g. a missing
 * prerequisite file the check itself would also flag) is logged at debug
 * level and skipped, not propagated — the post-fix re-verify still reports
 * whatever remains broken.
 */
const MIN_PORT = 1;
const MAX_PORT = 65_535;

/**
 * A TCP port, refusing what is not a whole number from 1 to 65535, which is no
 * port a server can listen on.
 */
const PORT: Refused<number> = {
  schema: whole.pipe(z.number().min(MIN_PORT).max(MAX_PORT)),
  refusal: {
    message: "{value} is not a TCP port",
    hint: "Use a TCP port from {min} to {max}.",
  },
  values: {
    min: MIN_PORT,
    max: MAX_PORT,
  },
};

/** What doctor is about, worked out once however many times it is asked for. */
/**
 * What doctor reads off the run to decide which server it is about. Named for
 * itself rather than taken from the command, so neither `sourceOf`, which is
 * handed the flags before the run has a context, nor `execute` has to assert
 * what the other one has.
 */
type Asked = Readonly<{
  port?: number;
  runtime?: string;
  image?: string;
}>;

type Checking = Readonly<{
  cwd: string;
  port: number;
  hostedServer: string | undefined;
}>;

/**
 * `zitadel doctor` — verify local runtime and project state.
 */
export default class Doctor extends Destructive(BaseCommand) {
  static override description = "Verify local runtime and project state.";
  static override group = CommandGroups.diagnostics;
  static override groupOrder = 1;

  static override flags = {
    fix: Flags.boolean({ description: "Repair missing files and stale managed wiring." }),
    force: Flags.boolean({
      char: "f",
      description:
        "With --fix, make repairs that replace an origin without the confirmation prompt. Required when non-interactive.",
      dependsOn: ["fix"],
    }),
    image: nonBlankString({ description: "Container image to check." }),
    port: Flags.custom<number>({
      parse: reads(PORT),
    })({
      description: "Local HTTP port to check. Defaults to the port this directory's server uses.",
    }),
    runtime: Flags.option({
      description: "Local runtime backend.",
      options: RUNTIME_BACKENDS,
    })(),
    // Doctor's local-runtime checks are about the machine, but with `--env` /
    // `--env-file` it also verifies the environment a command would connect to:
    // the same flags every EnvironmentCommand takes, resolved the same way.
    ...environmentFlags,
  };

  static override meta = {
    resolveServer: false,
  };

  /**
   * What doctor is about, worked out once: the port it checks and the hosted
   * server of a project that runs no local one. It is resolved before the
   * context is built, so the run's first event names the same server as its
   * last, and `execute` reads what was found rather than asking again.
   */
  private readonly started = startedServer(readNearestRuntimeMetadata);

  private readonly checking = new Map<string, Promise<Checking>>();

  protected override async sourceOf(flags: Asked, cwd: string): Promise<string> {
    const { port, hostedServer } = await this.checks(flags, cwd);
    return hostedServer ?? localServerUrl(port);
  }

  protected async execute({ flags }: Admitted<typeof Doctor>): Promise<JsonEnvelope> {
    const { port, hostedServer, cwd } = await this.checks(flags, this.cwd);
    const nearest = await this.started.of(cwd);
    const existingRuntime = nearest?.runtime;
    const parentRuntimeDir =
      nearest !== undefined && nearest.dir !== this.cwd ? nearest.dir : undefined;
    const runtimeBackend = resolveRuntimeBackend({
      runtime: flags.runtime,
      image: flags.image,
      envImage: this.env.ZITADEL_LOCAL_IMAGE,
      existingRuntime,
    });
    const image =
      flags.image ??
      this.env.ZITADEL_LOCAL_IMAGE ??
      defaultLocalServerImageForCliVersion(this.cliVersion);
    const runtimeChecks =
      hostedServer === undefined
        ? await runLocalRuntimeChecks(
            nearest?.dir ?? this.cwd,
            existingRuntime,
            runtimeBackend,
            image,
            port,
            this.localServers(),
            this.cliVersion,
            parentRuntimeDir,
          )
        : [];
    const selector = environmentSelectorSuffix({
      cwd: flags.cwd,
      envFile: flags.envFile,
      envName: flags.env,
      server: flags.server,
    });
    const hasConfig = await hasZitadelConfig(this.cwd);
    const ctx: CheckContext = {
      cwd: this.cwd,
      orca: createOrca(),
      cliVersion: this.cliVersion,
      selector,
      dryRun: this.dryRun,
      signal: this.signal,
      consent: (gate) => {
        return this.consent(gate);
      },
    };

    if (hasConfig && flags.fix) {
      const before = await Promise.all(
        SANITY_CHECKS.map((check) => {
          return check.run(ctx);
        }),
      );
      for (const [index, check] of SANITY_CHECKS.entries()) {
        // Repair warn-level drift too (e.g. a deleted presentation page):
        // fixes are restore-missing-only, so running one on a warning is safe.
        if (before[index]?.status === "pass") {
          continue;
        }
        try {
          await check.fix(ctx);
        } catch (error) {
          // Ctrl-C stops the run. A repair refused for want of --force is the
          // person's to approve, not one that failed: it is said, the other
          // repairs still run, and the check below still reports what is left.
          if (error instanceof ZitadelError && error.code === "E_CANCELLED") {
            throw error;
          }
          if (isRefusal(error) && error instanceof ZitadelError) {
            reportWarning(`${error.message}. ${error.hint ?? ""}`.trim());
            continue;
          }
          log.debug(`doctor --fix: ${check.name} repair failed`, error);
        }
      }
    }

    const projectChecks = hasConfig
      ? await Promise.all(
          SANITY_CHECKS.map((check) => {
            return check.run(ctx);
          }),
        )
      : [];
    const environmentChecks = await runEnvironmentChecks({
      cwd: this.cwd,
      env: this.env,
      envName: flags.env,
      envFile: flags.envFile,
      serverFlag: flags.server,
      signal: this.signal,
    });
    const versionCheck = await checkCliVersion({
      cliVersion: this.cliVersion,
      env: this.env,
      typedCwd: flags.cwd,
    });
    const checks = [versionCheck, ...runtimeChecks, ...projectChecks, ...environmentChecks];
    const failed = checks.filter((check) => {
      return check.status === "fail";
    });
    const warnings = checks.filter((check) => {
      return check.status === "warn";
    });
    // The claim check reads the local `.zitadel/secret`, which is setup's
    // project, so a claim is suggested only pinned to the file setup wrote for
    // it, as setup's own claim suggestion is: `--env-file` outranks the
    // process environment and the other `.env` files, which a bare claim
    // would read first and could name another project. Without a file that
    // names that very project nothing a command can carry selects it, so the
    // advice says so instead. The server is the project's own, from
    // `zitadel.json` where the claim check read it, not this run's `--server`.
    const projectId = await secretProjectId(this.cwd);
    // A `zitadel.json` that does not parse is the config check's to report,
    // not a reason for doctor itself to fail before it reports anything.
    const projectServer = hasConfig
      ? await readZitadelConfig(this.cwd).then(readProjectServer, () => {
          return flags.server;
        })
      : flags.server;
    // A bare claim resolves as this shell does, so it is offered unpinned only
    // when that resolution lands on the very project the check read.
    const bareResolves =
      projectId !== undefined &&
      (await resolveEnvironment({
        cwd: this.cwd,
        env: this.env,
      }).then(
        (environment) => {
          return environment.values.ZITADEL_PROJECT_ID?.value === projectId;
        },
        () => {
          return false;
        },
      ));
    const claimSelector = (await namesProject(
      join(this.cwd, ".env.development.local"),
      Promise.resolve(projectId),
    ))
      ? environmentSelectorSuffix({
          cwd: flags.cwd,
          envFile: projectEnvFile(flags.cwd, ".env.development.local"),
          server: projectServer,
        })
      : bareResolves
        ? environmentSelectorSuffix({
            cwd: flags.cwd,
            server: projectServer,
          })
        : undefined;
    const warningAdvice = advisoryForWarnings(warnings, this.cliVersion, claimSelector, selector);
    this.ui.ranAgainst(projectId, projectServer ?? this.meta.source);
    // A server that is running is one a sign-in or a request can fail
    // against, and its log is where the reason is.
    const serving =
      existingRuntime !== undefined &&
      runtimeChecks.find((check) => {
        return check.name === "runtime";
      })?.status === "pass";
    const nextActions = [
      ...(warningAdvice?.nextActions ?? []),
      ...(serving ? [serverLogAction(this.cliVersion)] : []),
    ];
    this.recordTelemetry({
      runtime: runtimeBackend,
      checks_total: checks.length,
      checks_failed: failed.length,
      checks_warn: warnings.length,
      failed_checks:
        failed.length > 0
          ? failed
              .map((check) => {
                return check.name;
              })
              .join(",")
          : undefined,
    });
    // One text, the same in the envelope and on the terminal.
    const planned = flags.fix === true && this.dryRun;
    const verdict =
      failed.length > 0
        ? "Zitadel doctor found issues"
        : warnings.length > 0
          ? "Checks passed with warnings"
          : "All checks passed";
    const title = planned ? `${verdict} (dry run)` : verdict;
    const data = {
      title,
      ...(planned ? { dry_run: true } : {}),
      ok: failed.length === 0,
      ...(hostedServer === undefined
        ? {
            runtime: runtimeBackend,
            ...(runtimeBackend === "docker" ? { image } : {}),
            port,
          }
        : {}),
      project: {
        lifecycle: hasConfig ? "configured" : "not-configured",
      },
      checks: withCategories(checks),
    };
    const next: NextSteps<SuggestedCommand> = {
      ...(nextActions.length > 0 ? { actions: nextActions } : {}),
      ...(warningAdvice || planned
        ? {
            commands: [
              ...(warningAdvice?.nextCommands ?? []),
              ...(planned
                ? [
                    projectCommand(
                      flags.force ? "doctor --fix --force" : "doctor --fix",
                      selector,
                      this.cliVersion,
                    ),
                  ]
                : []),
            ],
          }
        : {}),
    };
    const reportInput = {
      checks,
      cliVersion: this.cliVersion,
      typedCwd: flags.cwd,
      projectConfigured: hasConfig,
      hostedServer,
      runtime: runtimeBackend,
      port,
      next,
      fixes: warningAdvice?.fixes ?? [],
      verbose: this.meta.verbose,
      columns: this.isOnScreen ? process.stdout.columns : undefined,
    };

    if (failed.length > 0) {
      // The error block says only what to do next; which checks failed is here.
      this.log(renderDoctorReport(reportInput));
      this.log("");
      const advice = failureAdvice(
        failed,
        image,
        port,
        this.cliVersion,
        selector,
        parentRuntimeDir,
        flags.cwd,
      );
      // A check that failed with a typed CLI error advertises its own
      // category (e.g. the framework floor's E_UNSUPPORTED_PROJECT_SHAPE) —
      // surface that instead of the generic validation class so agents can
      // branch on it. The port check keeps its dedicated code first. The
      // details are the report a passing run would emit, next steps included.
      const report = {
        ...data,
        ...nextStepsData(next),
      };
      const code = failed.some((check) => {
        return check.name === "port";
      })
        ? "E_PORT_IN_USE"
        : (failed.find((check) => {
            return check.code !== undefined;
          })?.code ?? "E_VALIDATION");
      throw new ZitadelError(code, "Zitadel doctor found issues", {
        hint: advice.hint,
        nextCommands: advice.nextCommands,
        details:
          advice.suggestedArgs === undefined
            ? report
            : {
                ...report,
                suggested_args: advice.suggestedArgs,
              },
      });
    }

    const report = doctorReport(reportInput);
    // Only the terminal ending draws a summary's steps, so a pipe is given them as lines.
    const piped = this.isOnScreen ? "" : renderNextSteps(report.next);

    return this.emit({
      status: "ok",
      data,
      summary: {
        title,
        sections: [],
        lines: [...report.lines, ...(piped === "" ? [] : ["", ...piped.split("\n")])],
        ...(this.isOnScreen ? { next: stepsOf(report.next) } : {}),
      },
      next,
      warnings: warnings.map((warning) => {
        return `${warning.name}: ${warning.message}`;
      }),
      nextShown: asStepsShown(),
      warningsShown: true,
    });
  }

  private checks(flags: Asked, cwd: string): Promise<Checking> {
    // What was asked for as well as where, because the answer is read from
    // both: the same directory with another port named is another answer.
    const asked = `${cwd}\u0000${flags.port ?? ""}\u0000${flags.runtime ?? ""}\u0000${flags.image ?? ""}`;
    const already = this.checking.get(asked);
    if (already !== undefined) {
      return already;
    }
    const working = (async () => {
      // An unreadable record only costs the port hint; the read below reports it.
      const hint = await this.started.of(cwd).catch(() => {
        return undefined;
      });
      return {
        cwd,
        port: flags.port ?? hint?.runtime.port ?? DEFAULT_LOCAL_SERVER_PORT,
        hostedServer: await this.hostedServerWithoutLocalRuntime(flags, cwd),
      };
    })();
    this.checking.set(asked, working);
    return working;
  }

  /**
   * The server of a project set up against a hosted server, for which doctor
   * checks no local runtime: no local server runs for it, so the runtime says
   * nothing about it, and a port another app holds would fail it. `undefined`
   * (check the runtime) before setup, for a project on a local server or with
   * a `zitadel.json` that does not parse, where a server was started in the
   * directory or a parent, and when a flag asks about the runtime.
   */
  private async hostedServerWithoutLocalRuntime(
    flags: Asked,
    cwd: string = this.cwd,
  ): Promise<string | undefined> {
    if (flags.port !== undefined || flags.runtime !== undefined || flags.image !== undefined) {
      return undefined;
    }
    if (
      (await findUpward(cwd, LOCAL_RUNTIME_FILE)) !== undefined ||
      !(await hasZitadelConfig(cwd))
    ) {
      return undefined;
    }
    const server = await readZitadelConfig(cwd).then(readProjectServer, () => {
      return undefined;
    });
    return server === undefined || isLoopbackUrl(server) ? undefined : server;
  }
}

/**
 * What to do about the checks that failed: the hint doctor prints and the
 * commands it suggests. The checks are weighed in the order a reader would fix
 * them — the machine before the project — so one run advises on the first
 * failure that blocks the others rather than on all of them at once.
 */
export function failureAdvice(
  failed: CheckOutcome[],
  image: string,
  port: number,
  cliVersion: string,
  // The invocation's --env/--env-file/--server suffix. Appended only to the
  // retries that resolve the environment (the env-connect failure and the
  // project `--fix`); the local-runtime remedies — docker, port, image,
  // state-dir — are machine checks the selector would only clutter.
  selector: EnvironmentSelector,
  runtimeDir?: string,
  // doctor's own --cwd, carried by the `start` that gives that directory a server.
  cwdFlag?: string,
): { hint: string; nextCommands: SuggestedCommand[]; suggestedArgs?: string[][] } {
  const failedNames = new Set(
    failed.map((check) => {
      return check.name;
    }),
  );

  if (failedNames.has("server-binary")) {
    return {
      hint: "The Zitadel server npm package is not available. Reinstall the CLI package, then retry.",
      nextCommands: [unscopedCommand("doctor", cliVersion)],
    };
  }

  if (failedNames.has("docker-cli")) {
    const advice = dockerRuntimeGuidance("doctor", cliVersion);
    return {
      hint: advice.hint,
      nextCommands: advice.nextCommands,
    };
  }

  if (failedNames.has("image")) {
    return {
      hint: "The local Zitadel image is not available. Check Docker registry access, build it locally, or pass --image / ZITADEL_LOCAL_IMAGE.",
      nextCommands: [
        shellCommand(`docker pull ${Cmd.quote(image)}`),
        unscopedCommand("doctor", cliVersion),
      ],
    };
  }

  if (failedNames.has("state-dir")) {
    return {
      hint: `The local Zitadel state directory is not writable. Fix directory permissions, then rerun ${unscopedCommand("doctor", cliVersion)}.`,
      nextCommands: [unscopedCommand("doctor", cliVersion)],
    };
  }

  if (failedNames.has("port")) {
    const fallbackPort = port === DEFAULT_LOCAL_SERVER_PORT ? port + 1 : DEFAULT_LOCAL_SERVER_PORT;
    const stopCommand = unscopedCommand("stop --all", cliVersion);
    const retryCommand = unscopedCommand("doctor", cliVersion);
    const alternatePortCommand = unscopedCommand(
      `doctor --port ${String(fallbackPort)}`,
      cliVersion,
    );
    return {
      hint:
        `Port ${String(port)} is already in use. Stop the process using it, ` +
        `run ${stopCommand} for CLI-managed local runtimes, then rerun ` +
        `${retryCommand}; or choose another port with ${alternatePortCommand}.`,
      nextCommands: [stopCommand, retryCommand, alternatePortCommand],
    };
  }

  if (failedNames.has("runtime")) {
    // `start` and `reset` act on their working directory, so a runtime found
    // in a parent is named explicitly. The directory comes from the file
    // system and quoting differs between POSIX shells, PowerShell and cmd.exe,
    // so a path that needs quoting leaves the strings out and the argument
    // lists in `details.suggested_args` carry the recovery. A `start` without
    // the parent's `--cwd` gives the working directory a server of its own:
    // `start` does not look in parents.
    const startHere = cwdFlag === undefined ? ["start"] : ["start", "--cwd", cwdFlag];
    const suggestedArgs =
      runtimeDir === undefined
        ? [["start"], ["reset", "--force"]]
        : [["start", "--cwd", runtimeDir], startHere, ["reset", "--force", "--cwd", runtimeDir]];
    // One list at a time, so a parent that needs quoting costs only the
    // commands that name it, not the `start` that does not.
    const nextCommands = suggestedArgs.flatMap((args) => {
      return portableSuggestions([args], cliVersion);
    });
    const quotingNote =
      nextCommands.length < suggestedArgs.length
        ? ` The runtime is in ${runtimeDir ?? "the working directory"}, a directory that needs shell quoting, so the commands that name it are left out; run ${unscopedCommand("doctor --json", cliVersion)} and use details.suggested_args for the exact arguments.`
        : "";
    return {
      hint:
        runtimeDir === undefined
          ? "Existing local runtime metadata was found, but the local Zitadel server is not healthy. Start it again or reset stale local data." +
            quotingNote
          : `This folder has no Zitadel server of its own, so doctor checked the one in the parent folder, ${runtimeDir}, and found a problem with it. ` +
            `To keep using it, fix it or start it again. To give this folder its own server, run start here instead. Resetting deletes the local data in ${runtimeDir}, not in this folder.${quotingNote}`,
      nextCommands,
      suggestedArgs,
    };
  }

  // A failure that surfaced as a typed CLI error carries its own remedy —
  // e.g. the framework floor's upgrade hint. That beats the generic --fix
  // advice below, which cannot repair an unsupported version.
  const typed = failed.find((check) => {
    return check.code !== undefined && check.hint !== undefined;
  });
  if (typed?.hint !== undefined) {
    return {
      hint: typed.hint,
      nextCommands: [projectCommand("doctor", selector, cliVersion)],
    };
  }

  if (failedNames.has("environment")) {
    return {
      hint: `The resolved environment could not connect. Check the server, project and credential it resolves with ${projectCommand("env", selector, cliVersion)}, then rerun ${projectCommand("doctor", selector, cliVersion)}.`,
      nextCommands: [
        projectCommand("env", selector, cliVersion),
        projectCommand("doctor", selector, cliVersion),
      ],
    };
  }

  const hasProjectFailure = failed.some((check) => {
    return !LOCAL_RUNTIME_CHECK_NAMES.has(check.name);
  });
  if (hasProjectFailure) {
    return {
      hint: `Run ${projectCommand("doctor --fix", selector, cliVersion)} to re-apply missing managed files.`,
      nextCommands: [projectCommand("doctor --fix", selector, cliVersion)],
    };
  }

  return {
    hint: `Fix the reported checks, then rerun ${projectCommand("doctor", selector, cliVersion)}.`,
    nextCommands: [projectCommand("doctor", selector, cliVersion)],
  };
}

/** A warning's one repair: what it does, and the command that does it, for the check it repairs. */
export type WarningFix = { check: string; action: string; command: SuggestedCommand };

/**
 * The follow-ups doctor offers for its warnings: the Docker guidance, the claim
 * nudge, the managed-runtime review, an upgrade or dependency remedy, the
 * primary issuer origin and the meta-schema refresh. A follow-up that is one
 * command for one check is also a `fix`, which the report shows under that
 * check's row instead of among the next steps.
 */
export function advisoryForWarnings(
  warnings: CheckOutcome[],
  cliVersion: string,
  /**
   * The selector for the local project, which is the one the claim check
   * reads, or nothing when no selector reaches it.
   */
  local: EnvironmentSelector | undefined,
  /** This run's selection, which a suggested rerun of doctor carries. */
  selector: EnvironmentSelector,
): { nextActions: string[]; nextCommands: SuggestedCommand[]; fixes: WarningFix[] } | undefined {
  const nextActions: string[] = [];
  const nextCommands: SuggestedCommand[] = [];
  const fixes: WarningFix[] = [];
  const fix = (check: string, action: string, command: SuggestedCommand): void => {
    nextActions.push(action);
    nextCommands.push(command);
    fixes.push({
      check,
      action,
      command,
    });
  };
  if (
    warnings.some((check) => {
      return check.name === "docker-cli";
    })
  ) {
    const advice = dockerRuntimeGuidance("doctor", cliVersion);
    nextActions.push(...advice.nextActions);
    nextCommands.push(...advice.nextCommands);
  }

  const claimWarning = warnings.find((check) => {
    return check.name === "claim";
  });
  if (claimWarning) {
    // The check classified the window (details.claimable). Once it looks
    // closed the advisory switches to reconciliation wording, but the claim
    // command stays suggested either way: the local record can be stale
    // (claimed from another machine reads detached), and the server checks
    // the grant before the window, so running claim is safe and answers
    // authoritatively.
    if (local === undefined) {
      nextActions.push(
        `Claim this project with ${unscopedCommand("claim", cliVersion)} once .env.development.local sets ZITADEL_PROJECT_ID and ZITADEL_PROJECT_SECRET to the project in .zitadel/secret; until then claim would resolve a different project.`,
      );
    } else {
      fix(
        "claim",
        claimWindowClosed(claimWarning)
          ? claimWindowClosedAction(cliVersion, local)
          : claimAction(cliVersion, undefined, local),
        claimCommand(cliVersion, local),
      );
    }
  }

  const managedRuntimeWarning = warnings.find((check) => {
    return check.name === "managed-runtime-processes";
  });
  if (hasManagedRuntimeProcesses(managedRuntimeWarning)) {
    fix(
      "managed-runtime-processes",
      "Check the other local Zitadel servers before starting another; stop --all stops every one.",
      unscopedCommand("stop --all", cliVersion),
    );
  }

  const upgrade = remedyCommandOf(
    warnings.find((check) => {
      return check.name === "cli-version";
    }),
  );
  if (upgrade !== undefined) {
    fix(
      "cli-version",
      "Upgrade to the latest release; this moves the exactly-pinned @zitadel/* dependencies with it and refreshes generated files.",
      upgrade,
    );
  }

  const dependencyRemedy = remedyCommandOf(
    warnings.find((check) => {
      return check.name === "dependency-version";
    }),
  );
  // `upgrade` already moves the pins; aligning them with this older CLI as well
  // would send them backwards from where it leaves them.
  if (dependencyRemedy !== undefined && upgrade === undefined) {
    fix(
      "dependency-version",
      "Align the exactly-pinned @zitadel/* dependencies with the CLI version; scaffolded files and guidance target the CLI's train.",
      dependencyRemedy,
    );
  }

  if (
    warnings.some((check) => {
      return check.name === "issuer-origin";
    })
  ) {
    // The repair removes the origin and adds it back, which needs consent.
    fix(
      "issuer-origin",
      "Make the app's issuer a primary origin; a deploy lands only on primary origins, and setup 0.1.0 registered it as a preview one.",
      projectCommand("doctor --fix --force", selector, cliVersion),
    );
  }

  if (
    hasRepairableMetaSchemas(
      warnings.find((check) => {
        return check.name === "meta-schemas";
      }),
    )
  ) {
    fix(
      "meta-schemas",
      "Write this CLI version's editor schemas into .zitadel/meta/; editors and agents read the dialect from there.",
      projectCommand("doctor --fix", selector, cliVersion),
    );
  }

  if (nextActions.length === 0 && nextCommands.length === 0) {
    return undefined;
  }
  return {
    nextActions: [...new Set(nextActions)],
    nextCommands: [...new Set(nextCommands)],
    fixes,
  };
}

/**
 * Environment-aware checks, run only when `--env` / `--env-file` is given so a
 * plain `doctor` is unchanged (its default development environment is the local
 * server the runtime checks already cover). One authenticated `getProject`
 * against the resolved connection settles both questions at once: a response
 * proves the server is reachable, and that the resolved project exists and the
 * resolved credential can read it — the drift env resolution could introduce.
 *
 * Deliberately small: it does not re-run every sanity check against the remote
 * project (that would need the files the environment points at, which do not
 * exist locally), only the connection the environment resolves.
 */
async function runEnvironmentChecks(input: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  envName?: string;
  envFile?: string;
  serverFlag?: string;
  signal: AbortSignal;
}): Promise<CheckOutcome[]> {
  if (input.envName === undefined && input.envFile === undefined) {
    return [];
  }
  const resolved = await resolveEnvironment({
    cwd: input.cwd,
    env: input.env,
    envName: input.envName,
    envFile: input.envFile,
    serverFlag: input.serverFlag,
  }).then(
    (environment) => {
      return { environment };
    },
    (error: unknown) => {
      return { failure: error };
    },
  );
  if ("failure" in resolved) {
    return [
      {
        name: "environment",
        status: "fail",
        message: errorMessage(resolved.failure),
      },
    ];
  }
  const { environment } = resolved;
  const name = environment.name.value;
  return [
    await check(`environment`, `Resolved ${name} environment connects`, async () => {
      const server = environment.values.ZITADEL_URL?.value;
      const projectId = environment.values.ZITADEL_PROJECT_ID?.value;
      const token = environment.values.ZITADEL_PROJECT_SECRET?.value;
      if (server === undefined || projectId === undefined) {
        throw new Error(
          `ZITADEL_URL and ZITADEL_PROJECT_ID must resolve for the ${name} environment`,
        );
      }
      if (token === undefined) {
        throw new Error(
          `ZITADEL_PROJECT_SECRET must resolve to verify project ${projectId} on ${server}`,
        );
      }
      const project = await createZitadelClient({
        userAgent: userAgent(),
        baseUrl: server,
        token,
        signal: input.signal,
      }).getProject(projectId);
      if (project.id !== projectId) {
        throw new Error(`${server} returned project ${project.id}, not the resolved ${projectId}`);
      }
      return `${server} is reachable and project ${projectId} matches`;
    }),
  ];
}

/**
 * The local runtime checks, against the server in `runtimeDir` (the directory
 * holding its `.zitadel/local` state, or the current directory when no server
 * was started yet).
 */
async function runLocalRuntimeChecks(
  runtimeDir: string,
  runtime: RuntimeMetadata | undefined,
  runtimeBackend: RuntimeBackend,
  image: string,
  port: number,
  servers: LocalServers,
  cliVersion: string,
  inheritedFrom?: string,
): Promise<CheckOutcome[]> {
  const managedRuntimeCheck = await checkManagedRuntimeProcesses(runtime, servers);
  if (runtimeBackend === "binary") {
    return [
      await check("server-binary", "Server npm package is available", async () => {
        const version = LocalServer.assertBinaryAvailable();
        return `@zitadel/server ${version} is available`;
      }),
      await check(
        "state-dir",
        "Local state directory is writable",
        async () => {
          const probe = await assertLocalStateWritable(runtimeDir);
          return probe.checkedPath === probe.targetPath
            ? `${probe.targetPath} is writable`
            : `${probe.targetPath} can be created (${probe.checkedPath} is writable)`;
        },
        "warn",
      ),
      await check("port", `Port ${String(port)} is available`, () => {
        return checkPortAvailability(runtime, port);
      }),
      await checkRuntime(runtime, runtimeBackend, inheritedFrom),
      managedRuntimeCheck,
    ];
  }

  const docker = await check(
    "docker-cli",
    "Docker is reachable",
    async () => {
      const result = await LocalServer.dockerReachable().catch((error: unknown) => {
        throw new Error(dockerUnavailableMessage(error), { cause: error });
      });
      if (result.status !== 0) {
        throw new Error(dockerUnavailableMessage(result.stderr || "docker version failed"));
      }
      return `Docker engine ${result.stdout.trim() || "available"}`;
    },
    "warn",
  );

  const imageCheck =
    docker.status === "pass"
      ? await check(
          "image",
          `Image ${image} is available`,
          async () => {
            try {
              const source = await LocalServer.imageAvailable(image);
              return source === "local"
                ? `Image ${image} is available locally`
                : `Image ${image} is available from the registry`;
            } catch (error) {
              throw new Error(imageUnavailableMessage(image, error, cliVersion), { cause: error });
            }
          },
          "warn",
        )
      : ({
          name: "image",
          status: "warn",
          message: "Skipped image check because Docker is not reachable.",
        } satisfies CheckOutcome);

  return [
    docker,
    imageCheck,
    await check(
      "state-dir",
      "Local state directory is writable",
      async () => {
        const probe = await assertLocalStateWritable(runtimeDir);
        return probe.checkedPath === probe.targetPath
          ? `${probe.targetPath} is writable`
          : `${probe.targetPath} can be created (${probe.checkedPath} is writable)`;
      },
      "warn",
    ),
    await check("port", `Port ${String(port)} is available`, () => {
      return checkPortAvailability(runtime, port);
    }),
    await checkRuntime(runtime, runtimeBackend, inheritedFrom),
    managedRuntimeCheck,
  ];
}

async function checkPortAvailability(
  runtime: RuntimeMetadata | undefined,
  port: number,
): Promise<string> {
  if (runtime?.port === port && (await checkLocalServerHealth(runtime.server_url))) {
    return `${runtime.server_url} is already healthy`;
  }
  const listeners = await listenersForPort(port);
  if (listeners.length > 0) {
    throw new PortInUseCheckError(port, localServerUrl(port), listeners);
  }
  return `Port ${String(port)} is available`;
}

class PortInUseCheckError extends Error {
  readonly port: number;
  readonly serverUrl: string;
  readonly listeners: Awaited<ReturnType<typeof listenersForPort>>;

  constructor(
    port: number,
    serverUrl: string,
    listeners: Awaited<ReturnType<typeof listenersForPort>>,
  ) {
    super(`Port ${String(port)} is already in use by ${formatListeners(listeners)}`);
    this.port = port;
    this.serverUrl = serverUrl;
    this.listeners = listeners;
  }
}

async function checkManagedRuntimeProcesses(
  runtime: RuntimeMetadata | undefined,
  servers: LocalServers,
): Promise<CheckOutcome> {
  const discovery = await servers.current();
  if (!discovery.supported) {
    return {
      name: "managed-runtime-processes",
      status: "warn",
      message: "Could not look for other local Zitadel servers on this machine.",
      details: {
        supported: false,
        error: discovery.error,
      },
    };
  }
  const processes = additionalManagedRuntimeProcesses(discovery.processes, runtime);
  if (processes.length === 0) {
    return {
      name: "managed-runtime-processes",
      status: "pass",
      message: "No other local Zitadel server is running on this machine.",
      details: {
        supported: true,
        scope: "host",
        processes: [],
      },
    };
  }
  return {
    name: "managed-runtime-processes",
    status: "warn",
    message:
      new Intl.PluralRules("en").select(processes.length) === "one"
        ? "1 other local Zitadel server is running on this machine."
        : `${String(processes.length)} other local Zitadel servers are running on this machine.`,
    details: {
      supported: true,
      scope: "host",
      processes,
    },
  };
}

function additionalManagedRuntimeProcesses(
  processes: ReadonlyArray<ManagedRuntimeProcess>,
  runtime: RuntimeMetadata | undefined,
): ReadonlyArray<ManagedRuntimeProcess> {
  if (runtime?.backend !== "binary") {
    return processes;
  }
  return processes.filter((processInfo) => {
    return processInfo.pid !== runtime.pid && processInfo.ppid !== runtime.pid;
  });
}

async function checkRuntime(
  runtime: { backend: RuntimeBackend; server_url: string } | undefined,
  runtimeBackend: RuntimeBackend,
  inheritedFrom?: string,
): Promise<CheckOutcome> {
  return check("runtime", "Existing local runtime is healthy", async () => {
    if (!runtime) {
      return "No existing runtime metadata";
    }
    if (runtime.backend !== runtimeBackend) {
      throw new Error(
        `Existing local runtime uses ${runtime.backend}; run start --runtime ${runtimeBackend} to switch backends.`,
      );
    }
    if (!(await checkLocalServerHealth(runtime.server_url))) {
      throw new Error(`${runtime.server_url} is not ready: /readyz did not answer ok`);
    }
    return inheritedFrom === undefined
      ? `${runtime.server_url} is healthy`
      : `${runtime.server_url} is healthy (server started in the parent folder ${inheritedFrom})`;
  });
}

function formatListeners(listeners: Awaited<ReturnType<typeof listenersForPort>>): string {
  return listeners
    .map((listener) => {
      return [
        listener.command ?? "unknown",
        listener.pid ? `pid ${String(listener.pid)}` : undefined,
      ]
        .filter(Boolean)
        .join(" ");
    })
    .join(", ");
}

/**
 * A warning may carry its own repair as `details.remedy_command` (today: the
 * dependency-version check's package-manager-aware exact-pin install).
 * Surfacing that string keeps the structured advisory identical to the
 * command quoted in the warning's prose.
 */
function remedyCommandOf(check: CheckOutcome | undefined): SuggestedCommand | undefined {
  if (check?.status !== "warn") {
    return undefined;
  }
  const details = check.details;
  if (typeof details !== "object" || details === null) {
    return undefined;
  }
  const remedy = (details as { remedy_command?: unknown }).remedy_command;
  return typeof remedy === "string" && remedy.length > 0 ? shellCommand(remedy) : undefined;
}

/**
 * Reads the claim check's window classification out of its details. Absent
 * or malformed details mean "not closed". The classification only selects
 * the advisory wording (deadline nudge vs reconciliation); the claim
 * command stays suggested either way, because the local record may be stale
 * and running claim lets the server answer authoritatively.
 */
function claimWindowClosed(check: CheckOutcome): boolean {
  const details = check.details;
  return (
    typeof details === "object" &&
    details !== null &&
    (details as { claimable?: unknown }).claimable === false
  );
}

/**
 * Whether the meta-schemas warning lists a missing or outdated file that this
 * CLI's `--fix` writes: not when the project pins a newer `@zitadel/*`
 * version, whose own doctor writes them. A file behind a symlink, or one the
 * CLI cannot read, only gets the warning's reason.
 */
function hasRepairableMetaSchemas(check: CheckOutcome | undefined): boolean {
  if (check?.status !== "warn") {
    return false;
  }
  const details = check.details as
    | { missing?: unknown[]; outdated?: unknown[]; newer_pin?: unknown }
    | undefined;
  return (
    details?.newer_pin === undefined &&
    (details?.missing?.length ?? 0) + (details?.outdated?.length ?? 0) > 0
  );
}

function hasManagedRuntimeProcesses(check: CheckOutcome | undefined): boolean {
  if (!check || check.status !== "warn") {
    return false;
  }
  const details = check.details;
  return (
    typeof details === "object" &&
    details !== null &&
    "supported" in details &&
    (details as { supported?: unknown }).supported === true &&
    Array.isArray((details as { processes?: unknown }).processes) &&
    ((details as { processes?: unknown[] }).processes?.length ?? 0) > 0
  );
}

async function check(
  name: string,
  fallback: string,
  run: () => Promise<string>,
  failureStatus: "warn" | "fail" = "fail",
): Promise<CheckOutcome> {
  try {
    return {
      name,
      status: "pass",
      message: await run(),
    };
  } catch (error) {
    if (error instanceof PortInUseCheckError) {
      return {
        name,
        status: failureStatus,
        message: error.message,
        details: {
          port: error.port,
          server_url: error.serverUrl,
          listeners: error.listeners,
        },
      };
    }
    return {
      name,
      status: failureStatus,
      message: error instanceof Error ? error.message : fallback,
    };
  }
}

function imageUnavailableMessage(image: string, error: unknown, cliVersion: string): string {
  const detail = errorMessage(error);
  const suffix = detail.trim() ? ` (${detail.trim()})` : "";
  return `Image ${image} is not available to Docker${suffix}; ${unscopedCommand("start", cliVersion)} may need a pull or a different image.`;
}

/** The project `.zitadel/secret` records, or nothing when it cannot be read. */
async function secretProjectId(cwd: string): Promise<string | undefined> {
  return (await hasZitadelSecret(cwd))
    ? readZitadelSecret(cwd).then(
        (secret) => {
          return secret.project_id;
        },
        () => {
          return undefined;
        },
      )
    : undefined;
}

/** Whether an env file sets `ZITADEL_PROJECT_ID` to this project. */
async function namesProject(
  path: string,
  projectId: Promise<string | undefined>,
): Promise<boolean> {
  const id = await projectId;
  if (id === undefined || !existsSync(path)) {
    return false;
  }
  // Read through the resolver, as `claim --env-file` would read it; the
  // process environment is left out, so only the file answers. The file must
  // carry the credential too: for one it lacks, a pinned claim would take
  // whatever secret the shell exports and send it along for this project.
  return resolveEnvironment({
    cwd: dirname(path),
    env: {},
    envFile: path,
  }).then(
    ({ values }) => {
      return values.ZITADEL_PROJECT_ID?.value === id && values.ZITADEL_PROJECT_SECRET !== undefined;
    },
    () => {
      return false;
    },
  );
}

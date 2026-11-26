import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { Flags } from "@oclif/core";
import { z } from "zod";

import {
  LocalRuntime,
  LocalServerRecordMalformedError,
  LocalServerRecordUnreadableError,
  StartedServer,
  ZitadelRuntime,
} from "@/lib/server";
import { createZitadelClient } from "@/lib/backend";
import { Claim } from "@/lib/claim";
import { Cmd } from "@/lib/cmd";
import { Consent } from "@/lib/consent";
import { Environment, EnvironmentError } from "@/lib/environment";
import { FsError } from "@/lib/fs";
import { errorMessage, isCancellation, ZitadelError, ZitadelLibError } from "@/lib/errors";
import { Output, warnings as invocationWarnings } from "@/lib/ui";
import { type Refusal, refusalError } from "@/cli/core/refusal";
import { CommandGroups } from "@/cli/commands/groups";
import { type Admitted, type CommandResult, nonBlankString } from "@/cli/core";
import { environmentFlags, projectEnvFile } from "@/cli/core/environment-flags";
import { reads, type Refused, whole } from "@/cli/core/flags";
import {
  asStepsShown,
  type NextSteps,
  nextStepsData,
  renderNextSteps,
  stepsOf,
} from "@/cli/core/next-steps";
import { createOrca } from "@/lib/orca";
import {
  Guidance,
  shellCommand,
  type Suggest,
  type SuggestedCommand,
  type SuggestWords,
} from "@/lib/suggestion";
import { Runtime } from "@/lib/runtime";
import { Project, ProjectError } from "@/lib/project";

import {
  AbstractSanityCheck,
  CheckFailure,
  checkCliVersion,
  type CheckContext,
  type CheckOutcome,
  SANITY_CHECKS,
} from "./checks";
import { LocalRuntimeChecks } from "./checks/local-runtime";
import { doctorReport, renderDoctorReport, withCategories } from "./report";
import { ServerCommand } from "@/cli/commands/server-command";
import { Previewable } from "@/cli/core/previewable";
import { Destructive } from "@/cli/core/destructive";
import { LocalServerCommand } from "@/cli/commands/server-command";
import { BaseCommand } from "@/cli/core";
import { Telemetered } from "@/cli/telemetry/telemetered";

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
const PORT = {
  schema: whole.pipe(z.number().min(MIN_PORT).max(MAX_PORT)),
  refusal: {
    message: "{value} is not a TCP port",
    hint: "Use a TCP port from {min} to {max}.",
  },
  values: {
    min: MIN_PORT,
    max: MAX_PORT,
  },
} as const satisfies Refused<number>;

/** How a run is refused when the runtime record of the folder it checks is not in the shape it is written in. */
const RECORD_MALFORMED_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Reset the local runtime, then start it again, each with the --cwd of the directory that holds it.",
  next: ["{reset}", "{start}"],
} as const satisfies Refusal;

/** How a run is refused when the runtime record of the folder it checks cannot be read. */
const RECORD_UNREADABLE_REFUSAL = {
  code: "E_VALIDATION",
  message: "{message}",
  hint: "Check that {path} and its directory are readable by you.",
} as const satisfies Refusal;

/** What doctor is about, worked out once however many times it is asked for. */
/** What a doctor run found, for the report that tells it. */
type Examination = Readonly<{
  checks: CheckOutcome[];
  failed: CheckOutcome[];
  warnings: CheckOutcome[];
  hasConfig: boolean;
  hostedServer: string | undefined;
  runtimeBackend: ReturnType<typeof LocalRuntime.resolveBackend>;
  image: string;
  port: number;
  parentRuntimeDir: string | undefined;
  again: DoctorAgain;
  warningAdvice: ReturnType<typeof advisoryForWarnings>;
  nextActions: readonly string[];
}>;

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
 * This doctor run again, as it was typed (its `--port`, `--image` and
 * `--runtime` kept): as it is, with `--fix`, and with `--fix --force`.
 */
export type DoctorAgain = Readonly<{
  rerun: SuggestedCommand;
  repair: SuggestedCommand;
  forcedRepair: SuggestedCommand;
}>;

/**
 * What to do about the checks that failed: the hint doctor prints and the
 * commands it suggests. The checks are weighed in the order a reader would fix
 * them — the machine before the project — so one run advises on the first
 * failure that blocks the others rather than on all of them at once.
 *
 * `start` and `reset` act on their working directory, so a runtime found in a
 * parent is named explicitly, and the argument lists in
 * `details.suggested_args` carry the same recovery. A `start` without the
 * parent's `--cwd` gives the working directory a server of its own: `start`
 * does not look in parents. A failure that surfaced as a typed CLI error
 * carries its own remedy, e.g. the framework floor's upgrade hint, which beats
 * the generic --fix advice because that cannot repair an unsupported version.
 *
 * @param failed - The checks that failed.
 * @param image - The container image the run checked.
 * @param port - The port the run checked.
 * @param suggest - Renders a suggestion with the run's own scope.
 * @param suggestWords - {@link suggest} as the words after the CLI.
 * @param again - This doctor run again, as it was typed.
 * @param runtimeDir - The folder whose server was checked, when it is a parent of the run's.
 * @returns The hint, the commands, and the same recovery as argument lists where one applies.
 */
export function failureAdvice(
  failed: CheckOutcome[],
  image: string,
  port: number,
  suggest: Suggest,
  suggestWords: SuggestWords,
  again: DoctorAgain,
  runtimeDir?: string,
): { hint: string; nextCommands: SuggestedCommand[]; suggestedArgs?: string[][] } {
  const failedNames = new Set(
    failed.map((check) => {
      return check.name;
    }),
  );

  if (failedNames.has("server-binary")) {
    return {
      hint: "The Zitadel server npm package is not available. Reinstall the CLI package, then retry.",
      nextCommands: [again.rerun],
    };
  }

  if (failedNames.has("docker-cli")) {
    return {
      hint: "Docker is required only for the managed local runtime (`zitadel start` and `--server local`). Start Docker, then retry; or target a remote server with `--server <url>`.",
      nextCommands: [shellCommand("docker", "version"), again.rerun],
    };
  }

  if (failedNames.has("image")) {
    return {
      hint: "The local Zitadel image is not available. Check Docker registry access, build it locally, or pass --image / ZITADEL_LOCAL_IMAGE.",
      nextCommands: [shellCommand("docker", "pull", Cmd.quote(image)), again.rerun],
    };
  }

  if (failedNames.has("state-dir")) {
    return {
      hint: `The local Zitadel state directory is not writable. Fix directory permissions, then rerun ${again.rerun}.`,
      nextCommands: [again.rerun],
    };
  }

  if (failedNames.has("port")) {
    const fallbackPort =
      [LocalRuntime.DEFAULT_PORT, port + 1].find((candidate) => {
        return candidate !== port;
      }) ?? port + 1;
    const stopCommand = suggest({
      id: "stop",
      flags: { all: true },
    });
    const retryCommand = again.rerun;
    const alternatePortCommand = suggest({
      id: "doctor",
      flags: { port: fallbackPort },
    });
    return {
      hint:
        `Port ${String(port)} is already in use. Stop the process using it, ` +
        `run ${stopCommand} for CLI-managed local runtimes, then rerun ` +
        `${retryCommand}; or choose another port with ${alternatePortCommand}.`,
      nextCommands: [stopCommand, retryCommand, alternatePortCommand],
    };
  }

  if (failedNames.has("runtime")) {
    const start = (cwd?: string) => {
      return {
        command: suggest({
          id: "start",
          flags: { cwd },
        }),
        words: suggestWords({
          id: "start",
          flags: { cwd },
        }),
      };
    };
    const reset = (cwd?: string) => {
      return {
        command: suggest({
          id: "reset",
          flags: { force: true, cwd },
        }),
        words: suggestWords({
          id: "reset",
          flags: { force: true, cwd },
        }),
      };
    };
    const recovery =
      runtimeDir === undefined
        ? [start(), reset()]
        : [start(runtimeDir), start(), reset(runtimeDir)];
    return {
      hint:
        runtimeDir === undefined
          ? "Existing local runtime metadata was found, but the local Zitadel server is not healthy. Start it again or reset stale local data."
          : `This folder has no Zitadel server of its own, so doctor checked the one in the parent folder, ${runtimeDir}, and found a problem with it. ` +
            `To keep using it, fix it or start it again. To give this folder its own server, run start here instead. Resetting deletes the local data in ${runtimeDir}, not in this folder.`,
      nextCommands: recovery.map(({ command }) => {
        return command;
      }),
      suggestedArgs: recovery.map(({ words }) => {
        return words;
      }),
    };
  }

  const unsupported = failed.find((check) => {
    return check.code === "E_UNSUPPORTED_PROJECT_SHAPE";
  });
  if (unsupported !== undefined) {
    return {
      hint: unsupported.message,
      nextCommands: [again.rerun],
    };
  }

  const typed = failed.find((check) => {
    return check.code !== undefined && check.hint !== undefined;
  });
  if (typed?.hint !== undefined) {
    return {
      hint: typed.hint,
      nextCommands: [again.rerun],
    };
  }

  if (failedNames.has("environment")) {
    return {
      hint: `The resolved environment could not connect. Check the server, project and credential it resolves with ${suggest({ id: "env" })}, then rerun ${again.rerun}.`,
      nextCommands: [suggest({ id: "env" }), again.rerun],
    };
  }

  const hasProjectFailure = failed.some((check) => {
    return !LOCAL_RUNTIME_CHECK_NAMES.has(check.name);
  });
  if (hasProjectFailure) {
    const fix = again.repair;

    return {
      hint: `Run ${fix} to re-apply missing managed files.`,
      nextCommands: [fix],
    };
  }

  return {
    hint: `Fix the reported checks, then rerun ${again.rerun}.`,
    nextCommands: [again.rerun],
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
 *
 * The claim check classifies the window (details.claimable); absent or
 * malformed details mean "not closed". Once it looks
 * closed the advisory switches to reconciliation wording, but the claim
 * command stays suggested either way: the local record can be stale (claimed
 * from another machine reads detached), and the server checks the grant
 * before the window, so running claim is safe and answers authoritatively.
 * `upgrade` already moves the pins, so aligning them with an older CLI as well
 * would send them backwards from where it leaves them. The issuer-origin
 * repair removes the origin and adds it back, which needs consent. The
 * meta-schemas warning is repaired only when it lists a missing or outdated
 * file this CLI's `--fix` writes: not when the project pins a newer
 * `@zitadel/*` version, whose own doctor writes them, and a file behind a
 * symlink, or one the CLI cannot read, only gets the warning's reason.
 *
 * @param warnings - The checks that warned.
 * @param suggest - Renders a suggestion with the run's own scope.
 * @param local - Renders a suggestion for the local project, which is the one
 *   the claim check reads, or nothing when nothing a command can carry reaches it.
 * @param again - This doctor run again, as it was typed.
 * @returns The advice, or nothing when no warning has any.
 */
export function advisoryForWarnings(
  warnings: CheckOutcome[],
  suggest: Suggest,
  local: Suggest | undefined,
  again: DoctorAgain,
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
    nextActions.push(
      "Start Docker Desktop, Docker Engine, or a Docker-compatible runtime such as Colima.",
      "If you are not using the managed local runtime, run setup with --server <url> instead.",
    );
    nextCommands.push(shellCommand("docker", "version"), again.rerun);
  }

  const claimWarning = warnings.find((check) => {
    return check.name === "claim";
  });
  if (claimWarning) {
    if (local === undefined) {
      nextActions.push(
        `Claim this project with ${suggest({ id: "claim" })} once .env.development.local sets ZITADEL_PROJECT_ID and ZITADEL_PROJECT_SECRET to the project in .zitadel/secret; until then claim would resolve a different project.`,
      );
    } else {
      const claimDetails = claimWarning.details;
      const claimWindowClosed =
        typeof claimDetails === "object" &&
        claimDetails !== null &&
        (claimDetails as { claimable?: unknown }).claimable === false;
      fix(
        "claim",
        claimWindowClosed
          ? Claim.windowClosedNudge(
              local({ id: "claim" }),
              local({
                id: "setup",
                flags: { cwd: Claim.FRESH_DIRECTORY },
              }),
            )
          : Claim.nudge(local({ id: "claim" }), undefined),
        local({ id: "claim" }),
      );
    }
  }

  const managedRuntimeWarning = warnings.find((check) => {
    return check.name === "managed-runtime-processes";
  });
  const managedRuntimeDetails = managedRuntimeWarning?.details;
  const hasManagedRuntimeProcesses =
    managedRuntimeWarning?.status === "warn" &&
    typeof managedRuntimeDetails === "object" &&
    managedRuntimeDetails !== null &&
    "supported" in managedRuntimeDetails &&
    (managedRuntimeDetails as { supported?: unknown }).supported === true &&
    Array.isArray((managedRuntimeDetails as { processes?: unknown }).processes) &&
    ((managedRuntimeDetails as { processes?: unknown[] }).processes?.length ?? 0) > 0;
  if (hasManagedRuntimeProcesses) {
    fix(
      "managed-runtime-processes",
      "Check the other local Zitadel servers before starting another; stop --all stops every one.",
      suggest({
        id: "stop",
        flags: { all: true },
      }),
    );
  }

  const upgrade = warnings.find((check) => {
    return check.name === "cli-version";
  })?.remedy;
  if (upgrade !== undefined) {
    fix(
      "cli-version",
      "Upgrade to the latest release; this moves the exactly-pinned @zitadel/* dependencies with it and refreshes generated files.",
      upgrade,
    );
  }

  const dependencyRemedy = warnings.find((check) => {
    return check.name === "dependency-version";
  })?.remedy;
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
    fix(
      "issuer-origin",
      "Make the app's issuer a primary origin; a deploy lands only on primary origins, and setup 0.1.0 registered it as a preview one.",
      again.forcedRepair,
    );
  }

  const metaSchemasWarning = warnings.find((check) => {
    return check.name === "meta-schemas";
  });
  const metaSchemasDetails = metaSchemasWarning?.details as
    | { missing?: unknown[]; outdated?: unknown[]; newer_pin?: unknown }
    | undefined;
  const hasRepairableMetaSchemas =
    metaSchemasWarning?.status === "warn" &&
    metaSchemasDetails?.newer_pin === undefined &&
    (metaSchemasDetails?.missing?.length ?? 0) + (metaSchemasDetails?.outdated?.length ?? 0) > 0;
  if (hasRepairableMetaSchemas) {
    fix(
      "meta-schemas",
      "Write this CLI version's editor schemas into .zitadel/meta/; editors and agents read the dialect from there.",
      again.repair,
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
  const resolved = await Environment.resolve({
    servers: ZitadelRuntime,
    cwd: input.cwd,
    env: input.env,
    envName: input.envName,
    envFile: input.envFile,
    serverFlag: input.serverFlag,
  })
    .then((environment) => {
      return { environment };
    })
    .catch((error: unknown) => {
      if (error instanceof EnvironmentError) {
        return { failure: error };
      }
      if (error instanceof FsError) {
        return { failure: error };
      }
      throw error;
    });
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
    await AbstractSanityCheck.attempt(
      `environment`,
      `Resolved ${name} environment connects`,
      async () => {
        const server = environment.values.ZITADEL_URL?.value;
        const projectId = environment.values.ZITADEL_PROJECT_ID?.value;
        const token = environment.values.ZITADEL_PROJECT_SECRET?.value;
        if (server === undefined || projectId === undefined) {
          throw new CheckFailure(
            `ZITADEL_URL and ZITADEL_PROJECT_ID must resolve for the ${name} environment`,
          );
        }
        if (token === undefined) {
          throw new CheckFailure(
            `ZITADEL_PROJECT_SECRET must resolve to verify project ${projectId} on ${server}`,
          );
        }
        const project = await createZitadelClient({
          userAgent: Runtime.current().userAgent(),
          baseUrl: server,
          token,
          signal: input.signal,
        }).getProject(projectId);
        if (project.id !== projectId) {
          throw new CheckFailure(
            `${server} returned project ${project.id}, not the resolved ${projectId}`,
          );
        }
        return `${server} is reachable and project ${projectId} matches`;
      },
    ),
  ];
}

/**
 * `zitadel doctor` — verify local runtime and project state.
 */
export default class Doctor extends Telemetered(
  Destructive(
    LocalServerCommand(Previewable(ServerCommand(BaseCommand))),
    "With --fix, make repairs that replace an origin without the confirmation prompt. Required when non-interactive.",
  ),
) {
  static override description = "Verify local runtime and project state.";
  static override group = CommandGroups.gettingStarted;
  static override readonly headline = "failed_checks";
  static override groupOrder = 3;

  static override examples = ["<%= config.bin %> doctor", "<%= config.bin %> doctor --fix"];

  /**
   * The flags every command of this kind takes, with `--force` given the one
   * relation doctor adds: it repairs what `--fix` finds, so it needs `--fix`.
   */
  static override baseFlags = {
    ...super.baseFlags,
    force: {
      ...super.baseFlags.force,
      dependsOn: ["fix"],
    },
  };

  /**
   * Doctor's local-runtime checks are about the machine, but with `--env` /
   * `--env-file` it also verifies the environment a command would connect to:
   * the same flags every EnvironmentCommand takes, resolved the same way.
   */
  static override flags = {
    fix: Flags.boolean({ description: "Repair missing files and stale managed wiring." }),
    image: nonBlankString({ description: "Container image to check." }),
    port: Flags.custom<number>({
      parse: reads(PORT),
    })({
      description: "Local HTTP port to check. Defaults to the port this directory's server uses.",
    }),
    runtime: Flags.option({
      description: "Local runtime backend.",
      options: LocalRuntime.BACKENDS,
    })(),
    ...environmentFlags,
  };

  /**
   * What doctor is about, worked out once: the port it checks and the hosted
   * server of a project that runs no local one. It is resolved before the
   * context is built, so the run's first event names the same server as its
   * last, and `execute` reads what was found rather than asking again.
   */
  private readonly started = new StartedServer(LocalRuntime.readNearest);

  /** The checks begun for each directory, so a directory is checked once however often it is asked. */
  private readonly checking = new Map<string, Promise<Checking>>();

  /**
   * The server doctor is about: the hosted one of a project that runs no local
   * server, or else the local server's URL.
   *
   * @param flags - The flags as parsed.
   * @param cwd - The directory the run addresses.
   * @returns The server's URL.
   */
  protected override async sourceOf(flags: Asked, cwd: string): Promise<string> {
    const { port, hostedServer } = await this.checks(flags, cwd);
    return hostedServer ?? LocalRuntime.urlOf(port);
  }

  /**
   * Says what the command would do, without doing it. A repair under `--fix` is
   * only planned, and the run suggests the one that makes it.
   *
   * @param input.flags - The flags the command accepts.
   * @returns The envelope of the dry run.
   */
  protected async preview({ flags }: Admitted<typeof Doctor>): Promise<CommandResult> {
    const ctx: CheckContext = {
      cwd: this.cwd,
      orca: createOrca(LocalRuntime.DIR),
      cliVersion: this.cliVersion,
      suggest: this.suggest,
      dryRun: true,
      signal: this.signal,
      consent: (gate) => {
        return this.consent(gate);
      },
    };
    const examination = await this.examined(flags, ctx);
    const unplanned = flags.fix === true ? await this.realRun() : undefined;

    return this.reported(examination, unplanned);
  }

  /**
   * Does what the command is for.
   *
   * @param input.flags - The flags the command accepts.
   * @returns The envelope of the run.
   */
  protected async apply({ flags }: Admitted<typeof Doctor>): Promise<CommandResult> {
    const ctx: CheckContext = {
      cwd: this.cwd,
      orca: createOrca(LocalRuntime.DIR),
      cliVersion: this.cliVersion,
      suggest: this.suggest,
      dryRun: false,
      signal: this.signal,
      consent: (gate) => {
        return this.consent(gate);
      },
    };
    const examination = await this.examined(flags, ctx);

    return this.reported(examination, undefined);
  }

  /**
   * Checks the runtime and project, and repairs them with --fix unless the context plans only.
   *
   * Repair covers warn-level drift too (e.g. a deleted presentation page),
   * since fixes only restore what is missing and running one on a warning is
   * safe. Ctrl-C stops the run; a repair refused for want of --force is the
   * person's to approve, not one that failed, so it is said, the other repairs
   * still run, and the check afterwards still reports what is left.
   *
   * The claim check reads the local `.zitadel/secret`, which is setup's
   * project, so a claim is suggested only pinned to the file setup wrote for
   * it, as setup's own claim suggestion is: `--env-file` outranks the process
   * environment and the other `.env` files, which a bare claim would read
   * first and could name another project. Without a file that names that very
   * project nothing a command can carry selects it, so the advice says so
   * instead. The server is the project's own, from `zitadel.json` where the
   * claim check read it, not this run's `--server`; a `zitadel.json` that does
   * not parse is the config check's to report, not a reason for doctor itself
   * to fail before it reports anything. A bare claim resolves as this shell
   * does, so it is offered unpinned only when that resolution lands on the
   * very project the check read. A claim pinned to a file or a server cannot
   * also carry what the run's own scope would put back on it, so a run that
   * chose an environment of its own is told what to do instead of being sent
   * to a claim that could resolve another project.
   *
   * A server that is running is one a sign-in or a request can fail against,
   * and its log is where the reason is. The text is one, the same in the
   * envelope and on the terminal. Failing checks are reported on the terminal
   * and the error block says only what to do next. A check that failed with a
   * typed CLI error advertises its own category (e.g. the framework floor's
   * E_UNSUPPORTED_PROJECT_SHAPE), which is surfaced instead of the generic
   * validation class so agents can branch on it; the port check keeps its
   * dedicated code first, and the details are the report a passing run would
   * emit, next steps included. Only the terminal ending draws a summary's
   * steps, so a pipe is given them as lines.
   *
   * @param flags - The flags the command accepts.
   * @param ctx - What the checks are run with, which says whether a repair is done or only planned.
   * @returns What the run found, for {@link reported} to tell.
   */
  private async examined(
    flags: Admitted<typeof Doctor>["flags"],
    ctx: CheckContext,
  ): Promise<Examination> {
    const { port, hostedServer, cwd } = await this.checks(flags, this.cwd);
    const nearest = await this.started.of(cwd).catch(async (error: unknown) => {
      if (error instanceof LocalServerRecordMalformedError) {
        const directory = (await LocalRuntime.findUpward(cwd, LocalRuntime.FILE)) ?? cwd;
        throw refusalError(
          RECORD_MALFORMED_REFUSAL,
          {
            ...error,
            message: error.message,
          },
          {
            reset: {
              id: "reset",
              flags: {
                force: true,
                cwd: directory,
              },
            },
            start: {
              id: "start",
              flags: {
                cwd: directory,
              },
            },
          },
        );
      }
      if (error instanceof LocalServerRecordUnreadableError) {
        throw refusalError(RECORD_UNREADABLE_REFUSAL, {
          ...error,
          message: error.message,
        });
      }
      throw error;
    });
    const existingRuntime = nearest?.runtime;
    const parentRuntimeDir =
      nearest !== undefined && nearest.dir !== this.cwd ? nearest.dir : undefined;
    const runtimeBackend = LocalRuntime.resolveBackend({
      runtime: flags.runtime,
      image: flags.image,
      envImage: this.env.ZITADEL_LOCAL_IMAGE,
      existingRuntime,
    });
    const image =
      flags.image ?? this.env.ZITADEL_LOCAL_IMAGE ?? LocalRuntime.imageFor(this.cliVersion);
    const runtimeChecks =
      hostedServer === undefined
        ? await new LocalRuntimeChecks(
            nearest?.dir ?? this.cwd,
            existingRuntime,
            runtimeBackend,
            image,
            port,
            this.localServers(),
            this.suggest,
            parentRuntimeDir,
          ).run()
        : [];
    const hasConfig = await Project.at(this.cwd).hasConfig();

    if (hasConfig && flags.fix) {
      const before = await Promise.all(
        SANITY_CHECKS.map((check) => {
          return check.run(ctx);
        }),
      );
      for (const [index, check] of SANITY_CHECKS.entries()) {
        if (before[index]?.status === "pass") {
          continue;
        }
        try {
          await check.fix(ctx);
        } catch (error) {
          if (error instanceof ZitadelError) {
            if (isCancellation(error)) {
              throw error;
            }
            if (Consent.isRefusal(error)) {
              invocationWarnings.report(`${error.message}. ${error.hint ?? ""}`.trim());
              continue;
            }
            this.debug(`doctor --fix: ${check.name} repair failed`, error);
            invocationWarnings.report(`${check.name} could not be repaired: ${error.message}`);
            continue;
          }
          if (error instanceof ZitadelLibError) {
            this.debug(`doctor --fix: ${check.name} repair failed`, error);
            invocationWarnings.report(`${check.name} could not be repaired: ${error.message}`);
            continue;
          }
          throw error;
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
      suggest: this.suggest,
    });
    const checks = [versionCheck, ...runtimeChecks, ...projectChecks, ...environmentChecks];
    const failed = checks.filter((check) => {
      return check.status === "fail";
    });
    const warnings = checks.filter((check) => {
      return check.status === "warn";
    });
    const projectId = (await Project.at(this.cwd).hasSecret())
      ? await Project.at(this.cwd)
          .secret()
          .then((secret) => {
            return secret.data.project_id;
          })
          .catch((error: unknown) => {
            if (error instanceof ProjectError) {
              return undefined;
            }
            if (error instanceof FsError) {
              return undefined;
            }
            throw error;
          })
      : undefined;
    const projectServer = hasConfig
      ? await Project.at(this.cwd)
          .config()
          .then((config) => {
            return config.server ?? ZitadelRuntime.DEFAULT;
          })
          .catch((error: unknown) => {
            if (error instanceof ProjectError) {
              return flags.server;
            }
            if (error instanceof FsError) {
              return flags.server;
            }
            throw error;
          })
      : flags.server;
    const bareResolves =
      projectId !== undefined &&
      (await Environment.resolve({
        servers: ZitadelRuntime,
        cwd: this.cwd,
        env: this.env,
      })
        .then((environment) => {
          return environment.values.ZITADEL_PROJECT_ID?.value === projectId;
        })
        .catch((error: unknown) => {
          if (error instanceof EnvironmentError) {
            return false;
          }
          if (error instanceof FsError) {
            return false;
          }
          throw error;
        }));
    const developmentEnvFile = join(this.cwd, ".env.development.local");
    const namesProject =
      projectId !== undefined &&
      existsSync(developmentEnvFile) &&
      (await Environment.resolve({
        servers: ZitadelRuntime,
        cwd: dirname(developmentEnvFile),
        env: {},
        envFile: developmentEnvFile,
      })
        .then(({ values }) => {
          return (
            values.ZITADEL_PROJECT_ID?.value === projectId &&
            values.ZITADEL_PROJECT_SECRET !== undefined
          );
        })
        .catch((error: unknown) => {
          if (error instanceof EnvironmentError) {
            return false;
          }
          if (error instanceof FsError) {
            return false;
          }
          throw error;
        }));
    const claimSuggest = namesProject
      ? this.suggestWith({
          ...this.scope(),
          envFile: projectEnvFile(flags.cwd, ".env.development.local"),
          server: projectServer,
        })
      : bareResolves && flags.env === undefined && flags.envFile === undefined
        ? this.suggestWith({
            ...this.scope(),
            server: projectServer,
          })
        : undefined;
    const again: DoctorAgain = {
      rerun: await this.realRun(),
      repair: await this.again("doctor", {
        without: ["dryRun"],
        with: { fix: true },
      }),
      forcedRepair: await this.again("doctor", {
        without: ["dryRun"],
        with: { fix: true, force: true },
      }),
    };
    const warningAdvice = advisoryForWarnings(warnings, this.suggest, claimSuggest, again);
    this.ui.ranAgainst(projectId, projectServer ?? this.meta.source);
    const serving =
      existingRuntime !== undefined &&
      runtimeChecks.find((check) => {
        return check.name === "runtime";
      })?.status === "pass";
    const nextActions = [
      ...(warningAdvice?.nextActions ?? []),
      ...(serving ? [new Guidance(this.suggest).serverLog()] : []),
    ];
    this.annotate({
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

    return {
      checks,
      failed,
      warnings,
      hasConfig,
      hostedServer,
      runtimeBackend,
      image,
      port,
      parentRuntimeDir,
      again,
      warningAdvice,
      nextActions,
    };
  }

  /**
   * Tells what the run found: the verdict, the report a person reads, and the
   * failure it ends as when a check failed. A repair only planned is told in
   * the title and the data, and the command that makes it is the next step.
   *
   * @param examination - What the run found.
   * @param unplanned - The command that makes the repair a dry run only planned, if one was.
   * @returns The envelope of the run.
   * @throws {@link ZitadelError} When a check failed.
   */
  private async reported(
    examination: Examination,
    unplanned: SuggestedCommand | undefined,
  ): Promise<CommandResult> {
    const {
      checks,
      failed,
      warnings,
      hasConfig,
      hostedServer,
      runtimeBackend,
      image,
      port,
      parentRuntimeDir,
      again,
      warningAdvice,
      nextActions,
    } = examination;
    const planned = unplanned !== undefined;
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
              ...(unplanned === undefined ? [] : [unplanned]),
            ],
          }
        : {}),
    };
    const reportInput = {
      checks,
      cliVersion: this.cliVersion,
      suggest: this.suggest,
      projectConfigured: hasConfig,
      hostedServer,
      runtime: runtimeBackend,
      port,
      next,
      fixes: warningAdvice?.fixes ?? [],
      verbose: this.meta.verbose,
      columns: process.stdout.columns,
    };

    if (failed.length > 0) {
      this.log(renderDoctorReport(reportInput));
      this.log("");
      const advice = failureAdvice(
        failed,
        image,
        port,
        this.suggest,
        (next) => {
          return [...this.argsOf(this.suggest(next))];
        },
        again,
        parentRuntimeDir,
      );
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
    const stepsAsLines = Output.screen ? "" : renderNextSteps(report.next);

    return {
      status: "ok",
      data,
      summary: {
        title,
        sections: [],
        lines: [...report.lines, ...(stepsAsLines === "" ? [] : ["", ...stepsAsLines.split("\n")])],
        ...(Output.screen ? { next: stepsOf(report.next) } : {}),
      },
      next,
      warnings: warnings.map((warning) => {
        return `${warning.name}: ${warning.message}`;
      }),
      nextShown: asStepsShown(),
      warningsShown: true,
    };
  }

  /**
   * What doctor checks, memoised by what was asked for as well as where,
   * because the answer is read from both: the same directory with another port
   * named is another answer. An unreadable record only costs the port hint;
   * the read that follows reports it.
   *
   * @param flags - What the run was asked for.
   * @param cwd - The working directory.
   * @returns The port to check and the hosted server of a project with no local one.
   */
  private checks(flags: Asked, cwd: string): Promise<Checking> {
    const asked = `${cwd}\u0000${flags.port ?? ""}\u0000${flags.runtime ?? ""}\u0000${flags.image ?? ""}`;
    const already = this.checking.get(asked);
    if (already !== undefined) {
      return already;
    }
    const working = (async () => {
      const hostedServer = await this.hostedServerWithoutLocalRuntime(flags, cwd);
      try {
        const hint = await this.started.of(cwd);
        return {
          cwd,
          port: flags.port ?? hint?.runtime.port ?? LocalRuntime.DEFAULT_PORT,
          hostedServer,
        };
      } catch (error) {
        if (error instanceof LocalServerRecordUnreadableError) {
          return {
            cwd,
            port: flags.port ?? LocalRuntime.DEFAULT_PORT,
            hostedServer,
          };
        }
        if (error instanceof LocalServerRecordMalformedError) {
          return {
            cwd,
            port: flags.port ?? LocalRuntime.DEFAULT_PORT,
            hostedServer,
          };
        }
        throw error;
      }
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
      (await LocalRuntime.findUpward(cwd, LocalRuntime.FILE)) !== undefined ||
      !(await Project.at(cwd).hasConfig())
    ) {
      return undefined;
    }
    const server = await Project.at(cwd)
      .config()
      .then((config) => {
        return config.server ?? ZitadelRuntime.DEFAULT;
      })
      .catch((error: unknown) => {
        if (error instanceof ProjectError) {
          return undefined;
        }
        if (error instanceof FsError) {
          return undefined;
        }
        throw error;
      });
    if (server === undefined || ZitadelRuntime.fromUrl(server).isLoopback()) {
      return undefined;
    }
    return server;
  }
}

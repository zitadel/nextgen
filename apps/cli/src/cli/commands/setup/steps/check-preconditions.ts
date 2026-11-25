import { type Refusal, refusalError } from "@/cli/core/refusal";
import { isDirectoryOrMissing } from "@/lib/orca";
import {
  LocalServerNotRespondingElsewhereError,
  LocalServerNotRespondingError,
  LocalServerNotRunningError,
  ZitadelRuntime,
} from "@/lib/server";
import { WizardStep } from "@/lib/wizard";

import {
  type Fact,
  inspectWorktree,
  refuseOutdatedLocalServer,
  retryOptionsFromFlags,
  type SetupServices,
  setupRetryFlags,
  ssoRecovery,
} from "@/cli/commands/setup/shared";
import { Project } from "@/lib/project";

/** How `--server local` with no server ever started is refused. */
const NO_LOCAL_SERVER_REFUSAL = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "{message}",
  hint: "No local server has been started in this directory or a parent. Run `zitadel start`, or name a server another directory started with --server <url>. {scripting}{recovery}After setup succeeds, follow its next_commands to start the app and verify registration, logout, and login in the browser.",
  next: ["{start}", "{setup}"],
} as const satisfies Refusal;

/** How `--server local` with a recorded server that does not answer is refused. */
const LOCAL_SERVER_NOT_RESPONDING_REFUSAL = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "{message}",
  hint: "Run `zitadel start` to bring it back. {scripting}{recovery}After setup succeeds, follow its next_commands to start the app and verify registration, logout, and login in the browser.",
  next: ["{start}", "{setup}"],
} as const satisfies Refusal;

/** How `--server local` with a recorded server in another folder that does not answer is refused. */
const LOCAL_SERVER_ELSEWHERE_REFUSAL = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "{message}",
  hint: "It was started in another directory: run `zitadel start` there, or with --cwd, to bring it back. {scripting}{recovery}After setup succeeds, follow its next_commands to start the app and verify registration, logout, and login in the browser.",
  next: ["{start}", "{setup}"],
} as const satisfies Refusal;

/** How a `--cwd` that is a file, or lies under one, is refused. */
const NOT_A_DIRECTORY_REFUSAL = {
  message: "{cwd} is not a directory",
  hint: "Point --cwd at the app's directory, or at one that does not exist yet for setup to create.",
} as const satisfies Refusal;

/** How a directory holding a project secret with no configuration is refused. */
const SECRET_WITHOUT_CONFIG_REFUSAL = {
  code: "E_CONFLICT",
  message: ".zitadel/secret exists without zitadel.json",
  hint: "Move the secret aside or restore zitadel.json before running setup.",
} as const satisfies Refusal;

/** How a repository git cannot answer about is refused. */
const WORKTREE_UNKNOWN_REFUSAL = {
  code: "E_CONFLICT",
  message: "Could not tell whether the git working tree is clean: {reason}",
  hint: "Setup commits the files it writes, and will not do that without knowing the tree started clean. Fix what git is reporting, then run setup again, or pass --no-git to set up without touching version control.",
} as const satisfies Refusal;

/** How a repository where a commit would land in the wrong place is refused. */
const WORKTREE_BLOCKED_REFUSAL = {
  code: "E_CONFLICT",
  message: "Setup cannot commit here: {blocked}",
  hint: "Setup commits the project so the first release records a commit. Finish or abort what is under way, or check out a branch, then run setup again, or pass --no-git to set up without touching version control.",
} as const satisfies Refusal;

/** How a repository holding work the CLI did not write is refused. */
const WORKTREE_DIRTY_REFUSAL = {
  code: "E_CONFLICT",
  message: "The git working tree has {parts}",
  hint: "Setup commits the project directory so the first release records a commit, and it will not do that while there is work it did not write, which would be committed under setup's name. See them with git status, commit or stash them, then run setup again. If you have just scaffolded the app yourself, committing it first is the expected step. To set up without touching version control at all, pass --no-git.",
  details: {
    modified: "{modified}",
    untracked: "{untracked}",
  },
} as const satisfies Refusal;

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "machine" | "meta" | "suggest" | "useServer">;

/**
 * Checks everything that does not depend on an answer before anything is
 * detected, asked or written, and settles the server the run is about.
 *
 * @remarks
 * The server the run addresses is pinned on the command here, so every step
 * after this one reads the resolved one.
 */
export class CheckPreconditions extends WizardStep<"preconditions", Fact<"preflight">, Needs> {
  /**
   * The step's name, which a wizard refuses to hold twice.
   */
  readonly key = "preconditions";

  /**
   * What the command gives the step.
   */
  private readonly deps: Deps;

  /**
   * @param deps - What the command gives the step.
   */
  constructor(deps: Deps) {
    super();
    this.deps = deps;
  }

  /**
   * Refuse what cannot be done, and say what the run is about.
   *
   * @remarks
   * Everything setup checks before it detects, creates or writes anything: the server it is about,
   * that the directory can hold an app, that a half-removed project is not sitting there, and that
   * git is in a state setup may commit in. A directory already set up skips the git and
   * server-version checks, which are about making a project rather than changing one.
   *
   * The server is `--server` or the cloud default. `--server local` with nothing running is
   * refused, saying how to start it and how to rerun setup against it once it is.
   *
   * A repository setup must not commit in is refused. One snapshot answers all three questions:
   * git is asked once, not once per refusal.
   *
   * A local server another CLI release started is refused when `--server` names it
   * ({@link refuseOutdatedLocalServer}). Without `--server` the run is about the cloud until the
   * wizard asks, and its question does not offer such a server.
   *
   * @param needs - The flags.
   * @returns What was settled about the run.
   * @throws {@link ZitadelError} When the directory, the server or git cannot be used.
   */
  async run(needs: Needs): Promise<Fact<"preflight">> {
    const { flags } = needs;
    const { meta, suggest } = this.deps;
    // biome-ignore lint/plugin: the checks after the resolve need `server` and must not sit inside the try that translates its errors
    let server: Awaited<ReturnType<typeof ZitadelRuntime.resolve>>;
    try {
      server = await ZitadelRuntime.resolve({
        cwd: meta.cwd,
        serverFlag: meta.serverFlag,
      });
    } catch (error) {
      const retry = retryOptionsFromFlags(flags);
      const recovery = ssoRecovery(retry, suggest);
      const scripting =
        retry.sso && retry.sso.length > 0
          ? "The rerun asks for the client id and secret, because a command carries neither. " +
            "To script it instead, add --sso-client-id and --non-interactive, and pipe the secret in. "
          : "";
      const recovered =
        recovery.commands.length > 0
          ? `${recovery.hint}${recovery.commands.join(" ")} `
          : recovery.hint;
      if (error instanceof LocalServerNotRunningError) {
        throw refusalError(
          NO_LOCAL_SERVER_REFUSAL,
          {
            message: error.message,
            scripting,
            recovery: recovered,
          },
          {
            start: {
              id: "start",
              flags: {},
            },
            setup: {
              id: "setup",
              flags: setupRetryFlags(retry),
            },
          },
        );
      }
      if (error instanceof LocalServerNotRespondingError) {
        throw refusalError(
          LOCAL_SERVER_NOT_RESPONDING_REFUSAL,
          {
            message: error.message,
            scripting,
            recovery: recovered,
          },
          {
            start: {
              id: "start",
              flags: {},
            },
            setup: {
              id: "setup",
              flags: setupRetryFlags(retry),
            },
          },
        );
      }
      if (error instanceof LocalServerNotRespondingElsewhereError) {
        throw refusalError(
          LOCAL_SERVER_ELSEWHERE_REFUSAL,
          {
            message: error.message,
            scripting,
            recovery: recovered,
          },
          {
            start: {
              id: "start",
              flags: {
                cwd: error.directory,
              },
            },
            setup: {
              id: "setup",
              flags: setupRetryFlags(retry),
            },
          },
        );
      }
      throw error;
    }
    if (!(await isDirectoryOrMissing(meta.cwd))) {
      throw refusalError(NOT_A_DIRECTORY_REFUSAL, {
        cwd: meta.cwd,
      });
    }
    const configured = await Project.at(meta.cwd).hasConfig();
    if (!configured && (await Project.at(meta.cwd).hasSecret())) {
      throw refusalError(SECRET_WITHOUT_CONFIG_REFUSAL, {});
    }
    if (!configured && flags.git !== false) {
      const state = await inspectWorktree(meta.cwd);
      if (state.kind === "unknown") {
        throw refusalError(WORKTREE_UNKNOWN_REFUSAL, {
          reason: state.reason,
        });
      }
      if (state.kind === "blocked") {
        throw refusalError(WORKTREE_BLOCKED_REFUSAL, {
          blocked: state.blocked,
        });
      }
      if (state.kind === "dirty") {
        throw refusalError(WORKTREE_DIRTY_REFUSAL, {
          parts: new Intl.ListFormat("en", { type: "conjunction" }).format(
            [
              {
                noun: "uncommitted change",
                files: state.modified,
              },
              {
                noun: "untracked file",
                files: state.untracked,
              },
            ]
              .filter(({ files }) => {
                return files.length > 0;
              })
              .map(({ files, noun }) => {
                return `${files.length} ${noun}${new Intl.PluralRules("en").select(files.length) === "one" ? "" : "s"}`;
              }),
          ),
          modified: state.modified,
          untracked: state.untracked,
        });
      }
    }
    if (!configured) {
      await refuseOutdatedLocalServer({
        cwd: meta.cwd,
        machine: this.deps.machine,
        serverUrl: server.value,
        flags,
      });
    }
    this.deps.useServer(server.value);
    return {
      preflight: {
        server,
        configured,
      },
    };
  }
}

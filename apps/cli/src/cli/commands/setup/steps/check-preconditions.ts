import { WizardStep } from "@/lib/wizard";

import type { Fact, SetupServices } from "@/cli/commands/setup/shared";
import {
  inspectWorktree,
  retryOptionsFromFlags,
  setupRetryFlags,
  ssoRecovery,
} from "@/cli/commands/setup/shared";
import semver from "semver";
import { toZitadelError } from "@/lib/errors";
import { readNearestRuntimeMetadata } from "@/lib/local-server/runtime";
import { LocalServer } from "@/lib/local-server/server";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { isDirectoryOrMissing } from "@/lib/orca";
import { hasZitadelConfig, hasZitadelSecret } from "@/lib/project";
import { resolveServer } from "@/lib/server";

/** How `--server local` with nothing running is refused. */
const NO_LOCAL_SERVER_REFUSAL = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "Local Zitadel server is not running",
  hint: "{reason}Start local Zitadel first, then rerun setup. {scripting}{recovery}After setup succeeds, follow its next_commands to start the app and verify registration, logout, and login in the browser.",
  next: [{ id: "start" }, "{setup}"],
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

/** How a local server another CLI release started is refused. */
const SERVER_VERSION_REFUSAL = {
  code: "E_CONFLICT",
  message: "The local Zitadel server runs {running}, but this CLI ships {expected}",
  hint: "A server another CLI release started serves that release's API, so setup would stop halfway. Run start to restart it on {expected}; its data stays. {where}Then rerun setup.",
  next: ["{start}", "{setup}"],
  details: {
    server_url: "{serverUrl}",
    server_version: "{running}",
    cli_server_version: "{expected}",
  },
} as const satisfies Refusal;

/**
 * What the step reads from what is known.
 */
type Needs = Fact<"flags">;

/**
 * What the step is given by the command.
 */
type Deps = Pick<SetupServices, "meta" | "suggest" | "useServer">;

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
   * A local server another CLI release started is refused. `start` restarts such a server, but one
   * left running stays that release's until `start` runs again, and its API is that release's:
   * setup would create the project, then fail deploying the default schema and flow, and `--force`
   * would not help. Only a binary runtime records the version it runs, and only release versions
   * are compared: an override records `override`, which says nothing about its API. An unreadable
   * `runtime.json` is doctor's to report, not setup's. The version check compares against the
   * server this run is about. The start command names the server's own directory, so the typed
   * `--cwd` is not added to it.
   *
   * @param needs - The flags.
   * @returns What was settled about the run.
   * @throws {@link ZitadelError} When the directory, the server or git cannot be used.
   */
  async run(needs: Needs): Promise<Fact<"preflight">> {
    const { flags } = needs;
    const { meta, suggest } = this.deps;
    const server = await resolveServer({
      cwd: meta.cwd,
      serverFlag: meta.serverFlag,
    }).catch((error: unknown) => {
      const normalized = toZitadelError(error);
      if (normalized.code !== "E_LOCAL_SERVER_NOT_RUNNING") {
        throw error;
      }
      const retry = retryOptionsFromFlags(flags);
      const recovery = ssoRecovery(retry, suggest);
      throw refusalError(
        NO_LOCAL_SERVER_REFUSAL,
        {
          reason: normalized.hint ? `${normalized.hint} ` : "",
          scripting:
            retry.sso && retry.sso.length > 0
              ? "The rerun asks for the client id and secret, because a command carries neither. " +
                "To script it instead, add --sso-client-id and --non-interactive, and pipe the secret in. "
              : "",
          recovery:
            recovery.commands.length > 0
              ? `${recovery.hint}${recovery.commands.join(" ")} `
              : recovery.hint,
        },
        {
          setup: {
            id: "setup",
            flags: setupRetryFlags(retry),
          },
        },
      );
    });
    if (!(await isDirectoryOrMissing(meta.cwd))) {
      throw refusalError(NOT_A_DIRECTORY_REFUSAL, {
        cwd: meta.cwd,
      });
    }
    const configured = await hasZitadelConfig(meta.cwd);
    if (!configured && (await hasZitadelSecret(meta.cwd))) {
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
    const nearest = configured
      ? undefined
      : await readNearestRuntimeMetadata(meta.cwd).catch(() => {
          return undefined;
        });
    const runtime = nearest?.runtime;
    const expected = LocalServer.bundledVersion();
    if (
      nearest &&
      runtime?.backend === "binary" &&
      runtime.server_url === server.value &&
      expected !== undefined &&
      semver.valid(expected) &&
      semver.valid(runtime.server_version) &&
      runtime.server_version !== expected
    ) {
      throw refusalError(
        SERVER_VERSION_REFUSAL,
        {
          running: runtime.server_version,
          expected,
          serverUrl: runtime.server_url,
          where:
            nearest.dir === meta.cwd
              ? ""
              : `Run start in ${nearest.dir}, where the server was started. `,
        },
        {
          start:
            nearest.dir === meta.cwd
              ? { id: "start" }
              : {
                  id: "start",
                  flags: { cwd: nearest.dir },
                },
          setup: {
            id: "setup",
            flags: setupRetryFlags(retryOptionsFromFlags(flags)),
          },
        },
      );
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

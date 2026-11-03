import semver from "semver";

import { Cmd } from "../../lib/cmd";
import { toZitadelError } from "../../lib/errors";
import { readNearestRuntimeMetadata } from "../../lib/local-server/runtime";
import { LocalServer } from "../../lib/local-server/server";
import { type Refusal, refusalError } from "../../lib/oclif/refusal";
import type { GlobalOptions } from "../../lib/oclif/types";
import type { SuggestedCommand } from "../../lib/suggestion";
import { isDirectoryOrMissing } from "../../lib/orca";
import { hasZitadelConfig, hasZitadelSecret } from "../../lib/project";
import { resolveServer, type ResolvedServer } from "../../lib/server";
import { inspectWorktree, type WorktreeState } from "./initial-commit";
import { retryOptionsOf, setupRetryFlags, ssoRecovery } from "./retry";

/** How `--server local` with nothing running is refused. */
const NO_LOCAL_SERVER_REFUSAL: Refusal = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "Local Zitadel server is not running",
  hint:
    "{reason}Start local Zitadel first, then rerun setup. {scripting}{recovery}" +
    "After setup succeeds, follow its next_commands to start the app and verify registration, logout, and login in the browser.",
  next: ["start", "{setup}"],
};

/** How a `--cwd` that is a file, or lies under one, is refused. */
const NOT_A_DIRECTORY_REFUSAL: Refusal = {
  message: "{cwd} is not a directory",
  hint: "Point --cwd at the app's directory, or at one that does not exist yet for setup to create.",
};

/** How a directory holding a project secret with no configuration is refused. */
const SECRET_WITHOUT_CONFIG_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: ".zitadel/secret exists without zitadel.json",
  hint: "Move the secret aside or restore zitadel.json before running setup.",
};

/** How a repository git cannot answer about is refused. */
const WORKTREE_UNKNOWN_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "Could not tell whether the git working tree is clean: {reason}",
  hint:
    "Setup commits the files it writes, and will not do that without knowing the tree " +
    "started clean. Fix what git is reporting, then run setup again, or pass --no-git to " +
    "set up without touching version control.",
};

/** How a repository where a commit would land in the wrong place is refused. */
const WORKTREE_BLOCKED_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "Setup cannot commit here: {blocked}",
  hint:
    "Setup commits the project so the first release records a commit. Finish or abort what " +
    "is under way, or check out a branch, then run setup again, or pass --no-git to set up " +
    "without touching version control.",
};

/** How a repository holding work the CLI did not write is refused. */
const WORKTREE_DIRTY_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "The git working tree has {parts}",
  hint:
    "Setup commits the project directory so the first release records a commit, and it will not " +
    "do that while there is work it did not write, which would be committed under setup's name. " +
    "Run `git status` to see them, commit or stash them, then run setup again. If you have just scaffolded " +
    "the app yourself, committing it first is the expected step. To set up without touching " +
    "version control at all, pass --no-git.",
  details: {
    modified: "{modified}",
    untracked: "{untracked}",
  },
};

/** How a local server another CLI release started is refused. */
const SERVER_VERSION_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "The local Zitadel server runs {running}, but this CLI ships {expected}",
  hint:
    "A server another CLI release started serves that release's API, so setup would stop " +
    "halfway. Run start to restart it on {expected}; its data stays. {where}" +
    "Then rerun setup.",
  next: ["{start}", "{setup}"],
  details: {
    server_url: "{serverUrl}",
    server_version: "{running}",
    cli_server_version: "{expected}",
  },
};

/** What setup needs to know about the run before it detects or writes anything. */
export type SetupPreflight = Readonly<{
  server: ResolvedServer;
  configured: boolean;
}>;

/** How the preflight turns a command it names into one the reader can run. */
type Suggest = (command: string) => SuggestedCommand;

/** The flags setup's preflight reads. */
type PreflightFlags = Readonly<{
  git?: boolean;
  [flag: string]: unknown;
}>;

function plural(list: readonly unknown[]): string {
  return list.length === 1 ? "" : "s";
}

/**
 * The server setup is about, from `--server` or the cloud default. Refuses
 * `--server local` with nothing running, and says how to start it and how to
 * rerun setup against it once it is.
 */
async function resolveSetupServer(
  flags: PreflightFlags,
  meta: GlobalOptions,
  suggest: Suggest,
): Promise<ResolvedServer> {
  try {
    return await resolveServer({
      cwd: meta.cwd,
      serverFlag: meta.serverFlag,
    });
  } catch (error) {
    const normalized = toZitadelError(error);
    if (normalized.code !== "E_LOCAL_SERVER_NOT_RUNNING") {
      throw error;
    }
    const retry = retryOptionsOf(flags);
    const recovery = ssoRecovery(retry, meta.cliVersion);
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
            ? `${recovery.hint}${recovery.commands.map((command) => `\`${command}\``).join(" ")} `
            : recovery.hint,
        setup: `setup ${setupRetryFlags({ ...retry, cwd: undefined })}`,
      },
      suggest,
    );
  }
}

/**
 * Refuses a repository setup must not commit in. One snapshot answers all
 * three questions: git is asked once, not once per refusal.
 */
function refuseWorktree(state: WorktreeState): void {
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
  if (state.kind !== "dirty") {
    return;
  }
  const parts = [
    state.modified.length > 0
      ? `${state.modified.length} uncommitted change${plural(state.modified)}`
      : undefined,
    state.untracked.length > 0
      ? `${state.untracked.length} untracked file${plural(state.untracked)}`
      : undefined,
  ].filter((part) => {
    return part !== undefined;
  });
  throw refusalError(WORKTREE_DIRTY_REFUSAL, {
    parts: parts.join(" and "),
    modified: state.modified,
    untracked: state.untracked,
  });
}

/**
 * Refuses a local server another CLI release started. `start` restarts such a
 * server, but one left running stays that release's until `start` runs again,
 * and its API is that release's: setup would create the project, then fail
 * uploading the default schema and flow, and `--force` would not help.
 *
 * Only a binary runtime records the version it runs, and only release versions
 * are compared: an override records `override`, which says nothing about its
 * API. An unreadable `runtime.json` is doctor's to report, not setup's.
 */
async function refuseOtherReleasesServer(
  flags: PreflightFlags,
  meta: GlobalOptions,
  suggest: Suggest,
): Promise<void> {
  const nearest = await readNearestRuntimeMetadata(meta.cwd).catch(() => {
    return undefined;
  });
  const runtime = nearest?.runtime;
  if (!nearest || runtime?.backend !== "binary" || runtime.server_url !== meta.source) {
    return;
  }
  const expected = LocalServer.bundledVersion();
  if (
    expected === undefined ||
    !semver.valid(expected) ||
    !semver.valid(runtime.server_version) ||
    runtime.server_version === expected
  ) {
    return;
  }
  throw refusalError(
    SERVER_VERSION_REFUSAL,
    {
      running: runtime.server_version,
      expected,
      serverUrl: runtime.server_url,
      start: nearest.dir === meta.cwd ? "start" : `start ${Cmd.option("--cwd", nearest.dir)}`,
      where:
        nearest.dir === meta.cwd
          ? ""
          : `Run start in ${nearest.dir}, where the server was started. `,
      setup: `setup ${setupRetryFlags({ ...retryOptionsOf(flags), cwd: undefined })}`,
    },
    suggest,
  );
}

/**
 * Everything setup checks before it detects, creates or writes anything: the
 * server it is about, that the directory can hold an app, that a half-removed
 * project is not sitting there, and that git is in a state setup may commit
 * in. A directory already set up skips the git and server-version checks,
 * which are about making a project rather than changing one.
 */
export async function setupPreflight(
  flags: PreflightFlags,
  meta: GlobalOptions,
  suggest: Suggest,
): Promise<SetupPreflight> {
  const server = await resolveSetupServer(flags, meta, suggest);
  if (!(await isDirectoryOrMissing(meta.cwd))) {
    throw refusalError(NOT_A_DIRECTORY_REFUSAL, {
      cwd: meta.cwd,
    });
  }
  // The version check compares against the server this run is about, so the
  // rest of the preflight sees the resolved one.
  const resolved: GlobalOptions = {
    ...meta,
    source: server.value,
  };
  const configured = await hasZitadelConfig(meta.cwd);
  if (!configured && (await hasZitadelSecret(meta.cwd))) {
    throw refusalError(SECRET_WITHOUT_CONFIG_REFUSAL, {});
  }
  if (configured) {
    return {
      server,
      configured,
    };
  }
  if (flags.git !== false) {
    refuseWorktree(await inspectWorktree(meta.cwd));
  }
  await refuseOtherReleasesServer(flags, resolved, suggest);
  return {
    server,
    configured,
  };
}

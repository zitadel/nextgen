import { stat } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { Flags } from "@oclif/core";
import pc from "picocolors";

import { applyWithContext, resolveApplyContext } from "../lib/apply";
import { ZitadelError, toZitadelError } from "../lib/errors";
import {
  assertRuntimeFlags,
  launchLocalServer,
  resolveRuntimeBackend,
  stopLocalServer,
  validatePort,
} from "../lib/local-server/launch";
import {
  DEFAULT_LOCAL_SERVER_PORT,
  defaultLocalServerImageForCliVersion,
  localContainerName,
  localRuntimePaths,
  localServerUrl,
  type RuntimeBackend,
  type RuntimeMetadata,
} from "../lib/local-server/runtime";
import { BaseCommand, CommandGroups, type JsonEnvelope } from "../lib/oclif";
import { hasZitadelSecret } from "../lib/project";
import { publicCliCommand } from "../lib/public-cli";
import { resolveAppCommand, isAppSkipped, type AppCommand } from "../lib/run/app";
import { readKeys } from "../lib/run/keys";
import { tailLogFile } from "../lib/run/log-tail";
import { RunOutput } from "../lib/run/output";
import { SupervisedProcess } from "../lib/run/process";
import { resolveServer } from "../lib/server";

/** How long shutdown waits for an apply or a restart that is still running. */
const BUSY_DRAIN_TIMEOUT_MS = 30_000;

/**
 * `zitadel run` is the local development loop: the Zitadel server and the app's
 * dev server started together, their logs interleaved, and the repo config
 * reapplied on a keystroke.
 *
 * It is `start` + the app's own `dev` script + `apply`, held open in one
 * foreground session so changing a flow or a schema does not mean stopping to
 * run a second command in a second terminal:
 *
 * - `r` applies the repo config, the way `zitadel apply` does. Config-only
 *   changes are live on the running server the moment it returns.
 * - `R` does the same but around a full restart of both processes, for the
 *   changes a running server or a running bundler will not pick up (a `.env`
 *   edit, a dependency, a framework config file).
 * - `q` (or Ctrl-C) ends the session, stopping whatever this session started.
 */
export default class Run extends BaseCommand {
  static override description =
    "Run the local Zitadel server and your app together, applying config on a keystroke.";
  static override group = CommandGroups.localServer;
  static override groupOrder = 2;
  static override flags = {
    "app-command": Flags.string({
      description: "Command to start the app instead of the package manager's dev script.",
    }),
    app: Flags.boolean({
      default: true,
      allowNo: true,
      description: "Start the app dev server. Disable with --no-app.",
    }),
    apply: Flags.boolean({
      default: true,
      allowNo: true,
      description: "Apply repo config once at startup. Disable with --no-apply.",
    }),
    image: Flags.string({ description: "Container image to run." }),
    port: Flags.integer({ description: "Local HTTP port.", default: DEFAULT_LOCAL_SERVER_PORT }),
    runtime: Flags.string({
      description: "Local runtime backend.",
      options: ["binary", "docker"],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Run);
    const port = flags.port ?? DEFAULT_LOCAL_SERVER_PORT;
    const serverUrl = localServerUrl(port);
    // The session is about the server it starts, so that is its `source`.
    // Where config is applied is resolved after the server is up: a project
    // pinned with `--server local` cannot be resolved before then.
    await this.toMeta(flags, { resolveServer: false, source: serverUrl });

    validatePort(port);
    const backend = resolveRuntimeBackend({
      image: flags.image,
      runtime: flags.runtime,
      envImage: this.meta.env.ZITADEL_LOCAL_IMAGE,
    });
    assertRuntimeFlags(backend, flags.image);
    const image =
      flags.image ??
      this.meta.env.ZITADEL_LOCAL_IMAGE ??
      defaultLocalServerImageForCliVersion(this.meta.cliVersion);
    const containerName = localContainerName(this.meta.cwd);
    const app = flags.app ? await resolveAppCommand(this.meta.cwd, flags["app-command"]) : undefined;
    const appCommand = app && !isAppSkipped(app) ? app : undefined;
    const appSkipped = app && isAppSkipped(app) ? app.reason : flags.app ? undefined : "--no-app";
    this.recordTelemetry({ runtime: backend, app: Boolean(appCommand) });

    if (this.meta.dryRun) {
      return this.emit({
        status: "ok",
        data: {
          title: "Zitadel run plan.",
          runtime: {
            backend,
            ...(backend === "docker" ? { container_name: containerName, image } : {}),
            port,
          },
          app: appCommand
            ? { command: appCommand.display, port: appCommand.port }
            : { skipped: appSkipped },
          apply_on_start: flags.apply,
          keys: KEY_HELP,
          next_commands: [publicCliCommand("run", this.meta.cliVersion)],
        },
      });
    }

    if (this.jsonEnabled()) {
      throw new ZitadelError("E_VALIDATION", "Cannot stream a run session with --json", {
        hint: "Run without --json, or use `zitadel start` and `zitadel apply`, which both emit envelopes.",
        nextCommands: [
          publicCliCommand("start --json", this.meta.cliVersion),
          publicCliCommand("apply --json", this.meta.cliVersion),
        ],
      });
    }

    return this.session({
      appCommand,
      appSkipped,
      applyOnStart: flags.apply,
      backend,
      containerName,
      image,
      port,
      serverUrl,
    });
  }

  /** The foreground loop: start everything, stream it, act on keys, tear down. */
  private async session(input: {
    appCommand: AppCommand | undefined;
    appSkipped: string | undefined;
    backend: RuntimeBackend;
    applyOnStart: boolean;
    containerName: string;
    image: string;
    port: number;
    serverUrl: string;
  }): Promise<JsonEnvelope> {
    const out = new RunOutput();
    const { cwd, env } = this.meta;
    const logPath = localRuntimePaths(cwd).logFile;

    // Nothing else holds the event loop open for the length of the session:
    // the log tail polls on an unref'd timer, signal handlers do not count,
    // and a dev server that exits takes the last handle with it. Without this
    // the process would exit mid-session the moment the app crashed, leaving
    // the server it started behind. The session decides when it is over.
    const keepAlive = setInterval(() => undefined, 60_000);

    let server = await this.bootServer({ ...input, logPath, out });
    // Only what this session started is stopped when it ends: a server that
    // was already up belongs to whoever started it.
    let ownsServer = !server.adopted;
    let serverLogs = this.streamServerLogs(server.runtime, server.logOffset, out);

    const applyTarget = await this.resolveApplyTarget(input.serverUrl, out);
    const appProcess = input.appCommand
      ? new SupervisedProcess({
          command: input.appCommand.command,
          args: input.appCommand.args,
          cwd,
          env: process.env,
          onOutput: (chunk) => out.write("app", chunk),
          onUnexpectedExit: ({ code, signal }) => {
            out.flush();
            out.line(
              "cli",
              pc.yellow(
                `App dev server exited (${signal ?? `code ${String(code ?? 0)}`}). Press R to start it again.`,
              ),
            );
          },
        })
      : undefined;

    let applies = 0;
    let restarts = 0;
    let busy: string | undefined;
    let quitting = false;

    const applyConfig = async (): Promise<void> => {
      if (!applyTarget) {
        out.line("cli", "No project config to apply (no .zitadel/secret in this directory).");
        return;
      }
      out.line("cli", `Applying config to ${applyTarget}`);
      try {
        const context = await resolveApplyContext({ cwd, source: applyTarget, env });
        const { applied, filesUpdated } = await applyWithContext(context);
        applies += 1;
        out.line(
          "cli",
          pc.green(
            applied.length === 0
              ? "Config already in sync."
              : `Applied ${String(applied.length)} change${applied.length === 1 ? "" : "s"}${
                  filesUpdated.length > 0
                    ? `, updated ${String(filesUpdated.length)} local file${filesUpdated.length === 1 ? "" : "s"}`
                    : ""
                }.`,
          ),
        );
      } catch (error) {
        const failure = toZitadelError(error);
        out.line("cli", pc.red(`Apply failed (${failure.code}): ${failure.message}`));
        if (failure.hint) {
          out.line("cli", failure.hint);
        }
      }
    };

    const restartAll = async (): Promise<void> => {
      restarts += 1;
      await appProcess?.stop();
      serverLogs.stop();
      out.line("cli", "Restarting the local Zitadel server");
      await stopLocalServer(server.runtime);
      server = await this.bootServer({ ...input, logPath, out });
      ownsServer = true;
      serverLogs = this.streamServerLogs(server.runtime, server.logOffset, out);
      await applyConfig();
      if (appProcess && input.appCommand) {
        out.line("cli", `Restarting the app dev server: ${input.appCommand.display}`);
        appProcess.start();
      }
    };

    // Every keystroke goes through here: one action at a time, and a failure
    // is reported into the session rather than thrown, because an unhandled
    // rejection from a keypress would take the whole session down with it.
    const act = async (label: string, action: () => Promise<void>): Promise<void> => {
      if (busy) {
        out.line("cli", `${busy} is still running, ignoring ${label}.`);
        return;
      }
      busy = label;
      try {
        await action();
      } catch (error) {
        const failure = toZitadelError(error);
        out.line("cli", pc.red(`${label} failed (${failure.code}): ${failure.message}`));
        if (failure.hint) {
          out.line("cli", failure.hint);
        }
      } finally {
        busy = undefined;
      }
    };

    if (input.applyOnStart) {
      await act("the startup apply", applyConfig);
    }
    if (appProcess && input.appCommand) {
      out.line("cli", `Starting the app dev server: ${input.appCommand.display}`);
      appProcess.start();
    } else if (input.appSkipped) {
      out.line("cli", `No app dev server started: ${input.appSkipped}.`);
    }

    let resolveQuit = (): void => undefined;
    const quit = new Promise<void>((resolve) => {
      resolveQuit = resolve;
    });
    const requestQuit = (): void => {
      if (quitting) {
        return;
      }
      quitting = true;
      out.line("cli", "Shutting down");
      resolveQuit();
    };

    const keys = readKeys({
      onQuit: requestQuit,
      onKey: (key) => {
        switch (key) {
          case "r":
            void act("apply", applyConfig);
            return;
          case "R":
            void act("restart", restartAll);
            return;
          case "q":
            requestQuit();
            return;
          case "h":
          case "?":
            out.raw(keyHint(input.appCommand !== undefined));
            return;
          default:
            return;
        }
      },
    });
    // Without a TTY there is no keystroke to read, and Ctrl-C still arrives as
    // a signal because the terminal's own handling was never turned off.
    process.once("SIGINT", requestQuit);
    process.once("SIGTERM", requestQuit);

    out.raw("");
    out.raw(
      keys
        ? keyHint(input.appCommand !== undefined)
        : pc.dim("Not a terminal: keys are unavailable. Press Ctrl-C to stop."),
    );
    out.raw("");

    await quit;

    // An apply or a restart triggered a moment before the quit finishes what
    // it started; stopping the server underneath it would leave the sync
    // half-applied.
    await this.drainBusy(() => busy, out);
    keys?.stop();
    process.off("SIGINT", requestQuit);
    process.off("SIGTERM", requestQuit);
    await appProcess?.stop();
    serverLogs.stop();
    if (ownsServer) {
      await stopLocalServer(server.runtime);
    }
    clearInterval(keepAlive);
    out.flush();

    this.recordTelemetry({ applies, restarts });
    return this.emit({
      status: "ok",
      data: {
        title: "Zitadel run session ended.",
        runtime: {
          backend: server.runtime.backend,
          port: input.port,
          server_url: server.runtime.server_url,
          stopped: ownsServer,
        },
        app: input.appCommand
          ? { command: input.appCommand.display }
          : { skipped: input.appSkipped },
        session: { applies, restarts, config_target: applyTarget },
        next_actions: ownsServer
          ? ["The local Zitadel server was stopped; its data was kept."]
          : [
              "The local Zitadel server keeps running: it was already up when this session started.",
            ],
        next_commands: [publicCliCommand("run", this.meta.cliVersion)],
      },
    });
  }

  /**
   * Starts (or adopts) the local server and reports where its log file stood
   * beforehand, so the session streams this run's output and not the tail of
   * whatever ran in this directory before it.
   */
  private async bootServer(input: {
    backend: RuntimeBackend;
    containerName: string;
    image: string;
    logPath: string;
    out: RunOutput;
    port: number;
    serverUrl: string;
  }): Promise<{ adopted: boolean; logOffset: number; runtime: RuntimeMetadata }> {
    const before = await fileSize(input.logPath);
    const launch = await launchLocalServer({
      cwd: this.meta.cwd,
      env: this.meta.env,
      cliVersion: this.meta.cliVersion,
      backend: input.backend,
      containerName: input.containerName,
      image: input.image,
      port: input.port,
      serverUrl: input.serverUrl,
    });
    input.out.line(
      "cli",
      launch.alreadyRunning
        ? `Local Zitadel server already running at ${input.serverUrl}`
        : `Local Zitadel server ready at ${input.serverUrl}`,
    );
    return {
      adopted: launch.alreadyRunning,
      // An adopted server's log holds someone else's session; start at its end.
      logOffset: launch.alreadyRunning ? await fileSize(input.logPath) : before,
      runtime: launch.metadata,
    };
  }

  /** Streams the running server's output into the session, whichever backend it runs on. */
  private streamServerLogs(
    runtime: RuntimeMetadata,
    from: number,
    out: RunOutput,
  ): { stop: () => void } {
    if (runtime.backend === "binary") {
      return tailLogFile(runtime.log_path, {
        from,
        onChunk: (chunk) => out.write("server", chunk),
      });
    }
    // The container writes to docker's log driver rather than to a file this
    // process can read, so the stream comes from docker itself.
    const logs = new SupervisedProcess({
      command: "docker",
      args: ["logs", "--follow", "--tail", "0", runtime.container_name],
      onOutput: (chunk) => out.write("server", chunk),
    });
    logs.start();
    return { stop: () => void logs.stop() };
  }

  /**
   * Where `r` sends the repo config: the project's resolved server, which for
   * a project set up against the local runtime is the server this session just
   * started. Reported either way, because a project pointing elsewhere means
   * keystrokes reach a server other than the one printing logs here.
   */
  private async resolveApplyTarget(
    serverUrl: string,
    out: RunOutput,
  ): Promise<string | undefined> {
    if (!(await hasZitadelSecret(this.meta.cwd))) {
      out.line(
        "cli",
        pc.yellow("No .zitadel/secret here. Run `zitadel setup` to configure this app."),
      );
      return undefined;
    }
    const resolved = await resolveServer({
      cwd: this.meta.cwd,
      env: this.meta.env,
      serverFlag: this.meta.serverFlag,
      environment: "development",
    });
    if (resolved.value !== serverUrl) {
      out.line(
        "cli",
        pc.yellow(
          `Config applies to ${resolved.value}, not the local server this session started (${serverUrl}).`,
        ),
      );
    }
    return resolved.value;
  }

  /** Waits out an in-flight apply or restart before shutdown touches anything. */
  private async drainBusy(busy: () => string | undefined, out: RunOutput): Promise<void> {
    const label = busy();
    if (!label) {
      return;
    }
    out.line("cli", `Waiting for ${label} to finish`);
    const deadline = Date.now() + BUSY_DRAIN_TIMEOUT_MS;
    while (busy() && Date.now() < deadline) {
      await sleep(100, undefined, { ref: false });
    }
  }
}

const KEY_HELP = {
  r: "apply repo config",
  R: "apply and restart the server and the app",
  q: "stop the session",
  h: "reprint the key hint",
};

function keyHint(hasApp: boolean): string {
  const restart = hasApp ? "apply + restart server & app" : "apply + restart server";
  return pc.dim(
    `Keys  ${pc.bold("r")} apply  ·  ${pc.bold("R")} ${restart}  ·  ${pc.bold("q")} quit`,
  );
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

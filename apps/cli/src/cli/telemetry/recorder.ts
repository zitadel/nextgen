import { type ChannelListener, subscribe, unsubscribe } from "node:diagnostics_channel";

import { COMMAND_CHANNEL, type CommandEvent, type Notes } from "@/lib/oclif/events";
import { WRITE_CHANNEL, type WriteEvent } from "@/lib/oclif/crud/ops/write";
import { PUBLISH_CHANNEL, type PublishEvent } from "@/lib/publish";
import { ZitadelRuntime } from "@/lib/server";
import { Telemetry, type TelemetryDeps } from "@/lib/telemetry";
import { PROMPT_CHANNEL } from "@/lib/ui/chain";
import { WIZARD_CHANNEL, type WizardEvent } from "@/lib/wizard";

import type { Announcement } from "./announcement";
import type { GlobalOptions } from "@/lib/oclif/types";

import { type Follow, readObservation } from "./observation";
import {
  CLI_COMMAND_COMPLETED,
  CLI_COMMAND_FAILED,
  CLI_COMMAND_STARTED,
  commandEventProperties,
  deviceProfileProperties,
  FIRST_RUN_NOTICE,
  vercelEventKeys,
} from "./properties";

/**
 * What one run of a command is while it is followed.
 */
type Followed = {
  readonly client: Telemetry;
  readonly follow: Follow | undefined;
  readonly invocationId: string;
  /**
   * What the run is about, as of the latest announcement of the command.
   */
  meta: GlobalOptions;
};

/**
 * Where a recorder gets what it cannot make itself, so a test can stand in.
 */
export type RecorderDeps = Readonly<{
  /**
   * Makes the client that sends, which decides by consent whether anything does.
   */
  create?: (deps: TelemetryDeps) => Telemetry;
}>;

/**
 * The one place the CLI sends analytics from.
 *
 * @remarks
 * It listens to what the libraries and the base command announce, makes the
 * client when a run is opened, sends the three lifecycle events every command
 * has, and sends whatever the command's own logic says about the announcements
 * of its run. Nothing else in the CLI sends or builds an event. Every handler
 * swallows its own failures: a recorder never changes what a command does.
 */
export class Recorder {
  private static current: Recorder | undefined;

  private readonly runs = new Map<string, Followed>();
  private active: Followed | undefined;
  private readonly create: (deps: TelemetryDeps) => Telemetry;
  private readonly listeners: readonly (readonly [string, ChannelListener])[];

  /**
   * Start listening.
   *
   * @param deps - What a test replaces.
   */
  private constructor(deps: RecorderDeps) {
    this.create = deps.create ?? ((telemetry) => Telemetry.create(telemetry));
    const tagged = <T>(make: (event: T) => Announcement): ChannelListener => {
      return (message) => {
        this.guarded(() => {
          this.forward(this.active, make(message as T));
        });
      };
    };
    this.listeners = [
      [
        COMMAND_CHANNEL,
        (message) => {
          this.guarded(() => {
            this.command(message as CommandEvent);
          });
        },
      ],
      [WIZARD_CHANNEL, tagged<WizardEvent>((event) => ({ channel: "wizard", event }))],
      [PUBLISH_CHANNEL, tagged<PublishEvent>((event) => ({ channel: "publish", event }))],
      [WRITE_CHANNEL, tagged<WriteEvent>((event) => ({ channel: "write", event }))],
      [PROMPT_CHANNEL, tagged<unknown>(() => ({ channel: "prompt" }))],
    ];
    for (const [name, listener] of this.listeners) {
      subscribe(name, listener);
    }
  }

  /**
   * Start listening, once for the process.
   *
   * @param deps - What a test replaces.
   * @returns The recorder.
   */
  static install(deps: RecorderDeps = {}): Recorder {
    Recorder.current ??= new Recorder(deps);

    return Recorder.current;
  }

  /**
   * Stop listening.
   */
  dispose(): void {
    for (const [name, listener] of this.listeners) {
      unsubscribe(name, listener);
    }
    this.runs.clear();
    this.active = undefined;
    Recorder.current = undefined;
  }

  private command(event: CommandEvent): void {
    if (event.phase === "closing") {
      const run = this.runs.get(event.invocationId);
      if (run !== undefined) {
        event.settle.push(this.close(run));
      }
      return;
    }
    if (event.phase === "opened") {
      this.open(event);
    }
    const run = this.runs.get(event.invocationId);
    if (run === undefined || !run.client.enabled) {
      return;
    }
    run.meta = event.meta;
    if (event.phase === "completed") {
      this.send(run, event, CLI_COMMAND_COMPLETED, {
        ...event.notes,
        status: event.status,
        duration_ms: Date.now() - event.startedAt,
      });
    } else if (event.phase === "failed") {
      this.send(run, event, CLI_COMMAND_FAILED, {
        ...event.notes,
        status: "error",
        reason: event.code,
        exit_code: event.exitCode,
        duration_ms: Date.now() - event.startedAt,
      });
    }
    this.forward(run, { channel: "command", event });
  }

  private open(event: Extract<CommandEvent, { phase: "opened" }>): void {
    if (!event.observed) {
      return;
    }
    const observation = readObservation(event.observation);
    const client = this.create({
      env: process.env,
      flag: event.reporting,
      debug: event.meta.debug,
      vercelKeys: vercelEventKeys(observation.headline),
    });
    const run: Followed = {
      client,
      follow: observation.follow?.(),
      invocationId: event.invocationId,
      meta: event.meta,
    };
    this.runs.set(event.invocationId, run);
    this.active = run;
    if (!client.enabled) {
      return;
    }
    this.send(run, event, CLI_COMMAND_STARTED, { ...event.notes });
    if (client.isFirstRun) {
      client.profile(deviceProfileProperties(event.meta, client.distinctId), { $ip: 0 });
      if (event.interactive) {
        process.stderr.write(`${FIRST_RUN_NOTICE}\n`);
      }
    }
  }

  private send(
    run: Followed,
    event: Extract<CommandEvent, { meta: unknown }>,
    name: string,
    facts: Notes,
  ): void {
    run.client.track(
      name,
      commandEventProperties(
        event.meta,
        ZitadelRuntime.fromUrl(event.meta.source).kind,
        event.invocationId,
        facts,
      ),
    );
  }

  private forward(run: Followed | undefined, announcement: Announcement): void {
    if (run === undefined || !run.client.enabled || run.follow === undefined) {
      return;
    }
    for (const report of run.follow(announcement)) {
      run.client.track(
        report.name,
        commandEventProperties(
          run.meta,
          ZitadelRuntime.fromUrl(run.meta.source).kind,
          run.invocationId,
          report.facts,
        ),
      );
    }
  }

  private close(run: Followed): Promise<unknown> {
    return run.client.shutdown(1000).then(() => {
      if (run.client.enabled) {
        // A socket the sender left open must not keep a finished command alive.
        setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
      }
    });
  }

  private guarded(work: () => void): void {
    try {
      work();
    } catch {
      // Recording never changes what a command does.
    }
  }
}

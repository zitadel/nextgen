import { randomUUID } from "node:crypto";

import type { ZitadelError } from "@/lib/errors";
import { ZitadelRuntime } from "@/lib/server";
import type { Properties, Telemetry, TelemetryDeps } from "@/lib/telemetry";

import {
  CLI_COMMAND_COMPLETED,
  CLI_COMMAND_FAILED,
  CLI_COMMAND_STARTED,
  commandEventProperties,
  deviceProfileProperties,
  FIRST_RUN_NOTICE,
  vercelEventKeys,
} from "./command-telemetry";
import type { GlobalOptions } from "./types";

/**
 * The anonymous usage analytics of one invocation: the client, the dimensions
 * a command recorded, and the three lifecycle events every command fires. It
 * knows nothing of the command running it: every call is handed the run's
 * {@link GlobalOptions}, so a failure that came before the run settled its own
 * can report against the one it has.
 *
 * ```ts
 * const telemetry = new RunTelemetry((deps) => Telemetry.create(deps));
 * telemetry.open(meta, flag, interactive);
 * telemetry.completed(meta, "ok");
 * await telemetry.shutdown();
 * ```
 */
export class RunTelemetry {
  /** Makes the client; tests give one that records. */
  private readonly create: (deps: TelemetryDeps) => Telemetry;

  /** The client, created once by {@link open}. */
  private client?: Telemetry;

  /**
   * Per-command dimensions merged onto each lifecycle event emitted after they
   * are recorded, so `completed` and `failed` carry them and `started`, which
   * fires before a command body runs, does not. Replaced by {@link record},
   * never mutated in place.
   */
  private dimensions: Readonly<Properties> = Object.freeze({});

  /** Correlates the started and completed pair; minted at construction. */
  private readonly invocationId = randomUUID();

  /**
   * Wall-clock start `duration_ms` is derived from. Taken at construction,
   * before flag parsing and server resolution, so the duration covers the whole
   * invocation even when {@link open} is reached late from a failure.
   */
  private readonly startedAt = Date.now();

  /**
   * @param create - Makes the client from what {@link open} gathers.
   */
  constructor(create: (deps: TelemetryDeps) => Telemetry) {
    this.create = create;
  }

  /**
   * Merges command-specific dimensions into the ones recorded: a new frozen
   * bag replaces the previous one, so no shared object is ever mutated. `step`
   * advances by re-recording it at each milestone.
   *
   * @param patch - The dimensions to add or replace.
   */
  record(patch: Properties): void {
    this.dimensions = Object.freeze({ ...this.dimensions, ...patch });
  }

  /**
   * Creates the client once per invocation and fires `started`, with the
   * anonymous device profile and the first-run notice on a first run. Guarded
   * so a run that settles its context more than once does not count twice. An
   * inert client (opted out, a test runner, nowhere to send) returns before any
   * property bag is built, so a disabled run never resolves a timezone to a
   * country or parses a URL. The profile is install-level and stable, so it is
   * written on a first run only rather than paying a request on every command.
   *
   * @param meta - The run's context, read for every dimension.
   * @param flag - `--telemetry` as given, or `undefined` for the other signals to decide.
   * @param interactive - Whether a person is at the terminal, which gates the notice.
   */
  open(meta: GlobalOptions, flag: boolean | undefined, interactive: boolean): void {
    if (this.client) {
      return;
    }
    this.client = this.create({
      env: process.env,
      flag,
      debug: meta.debug,
      vercelKeys: vercelEventKeys(meta.command),
    });
    if (!this.client.enabled) {
      return;
    }
    this.client.track(CLI_COMMAND_STARTED, this.describe(meta, this.dimensions));
    if (this.client.isFirstRun) {
      this.client.profile(deviceProfileProperties(meta, this.client.distinctId), { $ip: 0 });
      if (interactive) {
        process.stderr.write(`${FIRST_RUN_NOTICE}\n`);
      }
    }
  }

  /**
   * Sends a product event of its own, with the header and context every CLI
   * event carries.
   *
   * @param event - The event an ADR names.
   * @param properties - What it carries.
   * @param meta - The run's context.
   */
  track(event: string, properties: Properties, meta: GlobalOptions): void {
    if (!this.client?.enabled) {
      return;
    }
    this.client.track(event, this.describe(meta, properties));
  }

  /**
   * Fires `completed`.
   *
   * @param meta - The run's context.
   * @param status - How the command ended.
   */
  completed(meta: GlobalOptions, status: string): void {
    if (!this.client?.enabled) {
      return;
    }
    this.client.track(
      CLI_COMMAND_COMPLETED,
      this.describe(meta, {
        ...this.dimensions,
        status,
        duration_ms: Date.now() - this.startedAt,
      }),
    );
  }

  /**
   * Fires `failed`.
   *
   * @param meta - The run's context.
   * @param error - The failure, as it is reported.
   */
  failed(meta: GlobalOptions, error: ZitadelError): void {
    if (!this.client?.enabled) {
      return;
    }
    this.client.track(
      CLI_COMMAND_FAILED,
      this.describe(meta, {
        ...this.dimensions,
        status: "error",
        reason: error.code,
        exit_code: error.exitCode,
        duration_ms: Date.now() - this.startedAt,
      }),
    );
  }

  /**
   * Flushes what is pending, so a short-lived process does not exit before the
   * lifecycle event is sent. The wait is bounded by the flush budget, so a hung
   * or firewalled network adds at most about a second.
   *
   * `mixpanel` keeps its sockets alive and exposes no timeout or handle, so a
   * completed or a hung request leaves one that holds Node's event loop open
   * past the wait. The failure path force-exits through oclif, but the success
   * path would hang, so an unref'd watchdog force-exits with the resolved code
   * if a socket is still open after the grace.
   */
  async shutdown(): Promise<void> {
    await this.client?.shutdown(1000);
    if (this.client?.enabled) {
      setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
    }
  }

  /**
   * The property bag of an event of this run.
   *
   * @param meta - The run's context.
   * @param properties - The dimensions the event carries.
   * @returns The bag.
   */
  private describe(meta: GlobalOptions, properties: Properties): Properties {
    return commandEventProperties(
      meta,
      ZitadelRuntime.fromUrl(meta.source).kind,
      this.invocationId,
      properties,
    );
  }
}

import { randomUUID } from "node:crypto";

import type { Mixpanel as MixpanelClient, Modifiers, Properties } from "mixpanel";

import { resolveTelemetryToken, type TelemetryEndpoint } from "./config";
import { resolveConsent } from "./consent";
import { type Identity, loadOrCreateIdentity } from "./identity";
import { MixpanelSink } from "./mixpanel-sink";
import { type TelemetrySink, trace } from "./sink";
import { compact } from "./util";
import { VercelSink } from "./vercel-sink";

export type { Properties, Modifiers } from "mixpanel";
export type { TelemetryRegion } from "./config";

/** Property bag accepted by {@link Telemetry.track} / {@link Telemetry.profile}. */
export type TelemetryProperties = Properties;

/**
 * Inputs to {@link Telemetry.create}. `env` is required; the rest are optional —
 * `flag`/`debug` are set by the production wiring, while `initClient`,
 * `loadIdentity`, and `newId` are test seams that default to the real
 * implementations when omitted.
 */
export type TelemetryDeps = {
  readonly env: NodeJS.ProcessEnv;
  /**
   * Resolved telemetry flag (the `--telemetry/--no-telemetry` value). Defaults
   * to `true` (telemetry enabled); `false` opts out. Undefined leaves the
   * decision to the other consent signals.
   */
  readonly flag?: boolean;
  /** Emit each payload to stderr before sending — for `--debug`. */
  readonly debug?: boolean;
  /**
   * The properties a copy of each event sends to Vercel Web Analytics, in
   * priority order. Without them no copy is sent.
   */
  readonly vercelKeys?: readonly string[];
  readonly initClient?: (token: string, endpoint: TelemetryEndpoint) => MixpanelClient;
  readonly loadIdentity?: (env: NodeJS.ProcessEnv) => Identity;
  readonly newId?: () => string;
  /** Sends the Vercel copy; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
};

/**
 * A generic, application-agnostic telemetry client for a single short process:
 * Mixpanel, when a token names a project, and a copy of each event for Vercel
 * Web Analytics. It knows nothing about commands, CLIs, or event names —
 * callers supply fully-built property bags. Its only opinions are operational,
 * because telemetry must never degrade the host program:
 *
 * - Never throws — a missing token, opt-out, or transport error all degrade to
 *   a silent no-op.
 * - Never blocks beyond {@link shutdown}'s timeout.
 * - Never writes to stdout; the optional debug trace goes to stderr.
 *
 * Inputs are treated as immutable: {@link track}/{@link profile} build a new
 * payload via spread and never mutate the bag they are given. The destinations
 * are {@link TelemetrySink}s, and this class only decides whether there are any
 * and hands each event to all of them.
 */
export class Telemetry {
  readonly distinctId: string;
  readonly isFirstRun: boolean;
  private readonly sinks: readonly TelemetrySink[];
  private readonly newId: () => string;

  private constructor(settings: {
    readonly distinctId: string;
    readonly isFirstRun: boolean;
    readonly sinks: readonly TelemetrySink[];
    readonly newId: () => string;
  }) {
    this.distinctId = settings.distinctId;
    this.isFirstRun = settings.isFirstRun;
    this.sinks = settings.sinks;
    this.newId = settings.newId;
  }

  /** Whether events will actually be sent: consent granted, and a destination to send to. */
  get enabled(): boolean {
    return this.sinks.length > 0;
  }

  /**
   * Resolve consent and where events go, then identity, and make the sinks. A
   * sink exists only when it has somewhere to send: Mixpanel when a token names
   * a project, the Vercel copy when there are properties to keep and an intake.
   * Without a destination, or on any failure along the way, the instance is
   * inert and its methods are no-ops; it then never writes an install id.
   */
  static create(deps: TelemetryDeps): Telemetry {
    const debug = deps.debug ?? false;
    const newId = deps.newId ?? randomUUID;
    const inert = (isFirstRun: boolean): Telemetry => {
      return new Telemetry({ distinctId: "", isFirstRun, sinks: [], newId });
    };

    const consent = resolveConsent({ env: deps.env, flag: deps.flag });
    trace(debug, () => {
      return `consent: ${consent.reason}`;
    });
    if (!consent.enabled) {
      return inert(false);
    }

    const token = resolveTelemetryToken(deps.env);
    if (!token) {
      trace(debug, () => {
        return "mixpanel: no token";
      });
    }
    const vercel = VercelSink.from({
      env: deps.env,
      keys: deps.vercelKeys,
      debug,
      fetch: deps.fetch ?? fetch,
    });
    if (!token && !vercel) {
      return inert(false);
    }

    const identity = (deps.loadIdentity ?? loadOrCreateIdentity)(deps.env);
    const mixpanel = MixpanelSink.connect({
      env: deps.env,
      token,
      distinctId: identity.distinctId,
      debug,
      init: deps.initClient,
    });
    const sinks = [mixpanel, vercel].filter((sink) => {
      return sink !== undefined;
    });
    if (sinks.length === 0) {
      return inert(identity.isFirstRun);
    }
    return new Telemetry({
      distinctId: identity.distinctId,
      isFirstRun: identity.isFirstRun,
      sinks,
      newId,
    });
  }

  /** Send an event with the given properties; `distinct_id`/`$insert_id` are stamped here. */
  track(event: string, properties: TelemetryProperties): void {
    const payload = compact({
      ...properties,
      distinct_id: this.distinctId,
      $insert_id: this.newId(),
    });
    for (const sink of this.sinks) {
      sink.track(event, payload);
    }
  }

  /** Write a user profile where the destination has one. `modifiers` carries `$ip` etc. */
  profile(properties: TelemetryProperties, modifiers: Modifiers = {}): void {
    const payload = compact(properties);
    for (const sink of this.sinks) {
      sink.profile(payload, modifiers);
    }
  }

  /**
   * Await in-flight sends so a short-lived process does not exit before the
   * requests complete, bounded by `timeoutMs` for every destination at once.
   * Safe to call on an inert instance.
   */
  async shutdown(timeoutMs = 2000): Promise<void> {
    await Promise.all(
      this.sinks.map((sink) => {
        return sink.flush(timeoutMs);
      }),
    );
  }
}

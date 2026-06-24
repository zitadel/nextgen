import { randomUUID } from "node:crypto";

import mixpanelLib, {
  type Mixpanel as MixpanelClient,
  type Modifiers,
  type Properties,
} from "mixpanel";

import { resolveTelemetryHost } from "./config";
import { resolveConsent } from "./consent";
import { type Identity, loadOrCreateIdentity } from "./identity";
import { compact } from "./util";

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
  readonly initClient?: (token: string, host: string) => MixpanelClient;
  readonly loadIdentity?: (env: NodeJS.ProcessEnv) => Identity;
  readonly newId?: () => string;
};

/**
 * A generic, application-agnostic Mixpanel client wrapper for a single short
 * process. It knows nothing about commands, CLIs, or event names — callers
 * supply fully-built property bags. Its only opinions are operational, because
 * telemetry must never degrade the host program:
 *
 * - Never throws — a missing token, opt-out, or transport error all degrade to
 *   a silent no-op.
 * - Never blocks beyond {@link shutdown}'s timeout.
 * - Never writes to stdout; the optional debug trace goes to stderr.
 *
 * Inputs are treated as immutable: {@link track}/{@link profile} build a new
 * payload via spread and never mutate the bag they are given.
 */
export class Telemetry {
  private readonly pending: Promise<void>[] = [];

  private constructor(
    private readonly client: MixpanelClient | undefined,
    readonly distinctId: string,
    readonly isFirstRun: boolean,
    private readonly debug: boolean,
    private readonly newId: () => string,
  ) {}

  /** Whether events will actually be sent (consent granted and a token configured). */
  get enabled(): boolean {
    return this.client !== undefined;
  }

  /**
   * Resolve consent, identity, token, and host, then build the Mixpanel client
   * lazily — only when consent is granted *and* a token is configured. Any
   * failure along the way yields an inert instance whose methods are no-ops.
   */
  static create(deps: TelemetryDeps): Telemetry {
    const newId = deps.newId ?? randomUUID;
    const debug = deps.debug ?? false;
    const inert = (firstRun: boolean): Telemetry =>
      new Telemetry(undefined, "", firstRun, debug, newId);

    const consent = resolveConsent({ env: deps.env, flag: deps.flag });
    if (debug) {
      process.stderr.write(`[telemetry] consent: ${consent.reason}\n`);
    }
    if (!consent.enabled || !consent.token) {
      return inert(false);
    }

    const identity = (deps.loadIdentity ?? loadOrCreateIdentity)(deps.env);

    let client: MixpanelClient | undefined;
    try {
      client = (deps.initClient ?? defaultInit)(consent.token, resolveTelemetryHost(deps.env));
    } catch {
      return inert(identity.isFirstRun);
    }
    return new Telemetry(client, identity.distinctId, identity.isFirstRun, debug, newId);
  }

  /** Send an event with the given properties; `distinct_id`/`$insert_id` are stamped here. */
  track(event: string, properties: TelemetryProperties): void {
    if (!this.client) {
      return;
    }
    const payload = compact({
      ...properties,
      distinct_id: this.distinctId,
      $insert_id: this.newId(),
    });
    if (this.debug) {
      process.stderr.write(`[telemetry] ${event} ${JSON.stringify(payload)}\n`);
    }
    this.enqueue((client, done) => client.track(event, payload, done));
  }

  /** Write a user profile via the People API. `modifiers` carries `$ip` etc. */
  profile(properties: TelemetryProperties, modifiers: Modifiers = {}): void {
    if (!this.client) {
      return;
    }
    const payload = compact(properties);
    if (this.debug) {
      process.stderr.write(`[telemetry] people.set ${JSON.stringify(payload)}\n`);
    }
    this.enqueue((client, done) => client.people.set(this.distinctId, payload, modifiers, done));
  }

  /**
   * Await in-flight sends so a short-lived process does not exit before the
   * requests complete, bounded by `timeoutMs`. Safe to call on an inert instance.
   */
  async shutdown(timeoutMs = 2000): Promise<void> {
    if (this.pending.length === 0) {
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    });
    try {
      await Promise.race([Promise.allSettled(this.pending), timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Enqueue one fire-and-forget send. Resolves (never rejects) on any failure —
   * a synchronous throw or an error callback must not surface to the caller or
   * leak as an unhandled rejection.
   */
  private enqueue(
    send: (client: MixpanelClient, done: () => void) => void,
  ): void {
    const client = this.client;
    if (!client) {
      return;
    }
    this.pending.push(
      new Promise<void>((resolve) => {
        try {
          send(client, () => resolve());
        } catch {
          resolve();
        }
      }),
    );
  }
}

/** Real Mixpanel client construction, isolated so {@link Telemetry.create} can swap it in tests. */
function defaultInit(token: string, host: string): MixpanelClient {
  return mixpanelLib.init(token, { host });
}

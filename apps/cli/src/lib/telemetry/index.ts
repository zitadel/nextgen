import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import mixpanelLib, {
  type Mixpanel as MixpanelClient,
  type Modifiers,
  type Properties,
} from "mixpanel";

import { resolveTelemetryEndpoint, type TelemetryEndpoint } from "./config";
import { resolveConsent } from "./consent";
import { type Identity, loadOrCreateIdentity } from "./identity";
import { compact } from "./util";
import { resolveVercelEndpoint, type VercelSink, vercelEventBody } from "./vercel";

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
   * priority order (proof of concept). Without them no copy is sent.
   */
  readonly vercelKeys?: readonly string[];
  readonly initClient?: (token: string, endpoint: TelemetryEndpoint) => MixpanelClient;
  readonly loadIdentity?: (env: NodeJS.ProcessEnv) => Identity;
  readonly newId?: () => string;
  /** Sends the Vercel copy; defaults to the global `fetch`. */
  readonly fetch?: typeof fetch;
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

  private readonly client: MixpanelClient | undefined;
  readonly distinctId: string;
  readonly isFirstRun: boolean;
  private readonly debug: boolean;
  private readonly newId: () => string;
  private readonly vercel: VercelSink | undefined;
  private readonly fetch: typeof fetch;

  private constructor(
    client: MixpanelClient | undefined,
    distinctId: string,
    isFirstRun: boolean,
    debug: boolean,
    newId: () => string,
    vercel: VercelSink | undefined,
    fetchFn: typeof fetch,
  ) {
    this.client = client;
    this.distinctId = distinctId;
    this.isFirstRun = isFirstRun;
    this.debug = debug;
    this.newId = newId;
    this.vercel = vercel;
    this.fetch = fetchFn;
  }

  /** Whether events will actually be sent (consent granted and a token configured). */
  get enabled(): boolean {
    return this.client !== undefined;
  }

  /**
   * Resolve consent, identity, token, and endpoint, then build the Mixpanel client
   * lazily — only when consent is granted *and* a token is configured. Any
   * failure along the way yields an inert instance whose methods are no-ops.
   */
  static create(deps: TelemetryDeps): Telemetry {
    const newId = deps.newId ?? randomUUID;
    const debug = deps.debug ?? false;
    const fetchFn = deps.fetch ?? fetch;
    const inert = (firstRun: boolean): Telemetry =>
      new Telemetry(undefined, "", firstRun, debug, newId, undefined, fetchFn);

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
      client = (deps.initClient ?? defaultInit)(consent.token, resolveTelemetryEndpoint(deps.env));
    } catch {
      return inert(identity.isFirstRun);
    }
    const vercelKeys = deps.vercelKeys?.length ? deps.vercelKeys : undefined;
    const vercelEndpoint = vercelKeys && resolveVercelEndpoint(deps.env);
    if (debug && vercelKeys && !vercelEndpoint) {
      process.stderr.write("[telemetry] vercel: no copy on the development channel\n");
    }
    const vercel =
      vercelKeys && vercelEndpoint ? { endpoint: vercelEndpoint, keys: vercelKeys } : undefined;
    return new Telemetry(
      client,
      identity.distinctId,
      identity.isFirstRun,
      debug,
      newId,
      vercel,
      fetchFn,
    );
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
    this.sendVercel(event, payload);
  }

  /** Send the Vercel copy of an event, fire-and-forget like every send. */
  private sendVercel(event: string, payload: TelemetryProperties): void {
    const sink = this.vercel;
    if (!sink) {
      return;
    }
    let body: string;
    try {
      body = vercelEventBody(event, payload, sink, Date.now());
    } catch {
      return;
    }
    if (this.debug) {
      process.stderr.write(`[telemetry] vercel ${body}\n`);
    }
    this.pending.push(
      Promise.resolve()
        .then(() =>
          this.fetch(sink.endpoint, {
            method: "POST",
            // The global dispatcher sets the CLI's User-Agent; `x-va-server`
            // is what `@vercel/analytics/server` sends.
            headers: { "content-type": "application/json", "x-va-server": "1" },
            body,
          }),
        )
        .then(
          (response) => {
            if (this.debug) {
              process.stderr.write(`[telemetry] vercel answered ${response.status}\n`);
            }
          },
          () => undefined,
        ),
    );
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
   * requests complete, bounded by `timeoutMs`. The timeout is unref'd so the
   * losing race branch never holds the event loop open or needs a manual clear.
   * Safe to call on an inert instance.
   */
  async shutdown(timeoutMs = 2000): Promise<void> {
    if (this.pending.length === 0) {
      return;
    }
    await Promise.race([
      Promise.allSettled(this.pending),
      delay(timeoutMs, undefined, { ref: false }),
    ]);
  }

  /**
   * Enqueue one fire-and-forget send. Resolves (never rejects) on any failure —
   * a synchronous throw or an error callback must not surface to the caller or
   * leak as an unhandled rejection.
   */
  private enqueue(send: (client: MixpanelClient, done: () => void) => void): void {
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
function defaultInit(token: string, { host, path }: TelemetryEndpoint): MixpanelClient {
  return mixpanelLib.init(token, { host, path, geolocate: false });
}

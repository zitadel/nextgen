import mixpanelLib, {
  type Mixpanel as MixpanelClient,
  type Modifiers,
  type Properties,
} from "mixpanel";

import { resolveTelemetryEndpoint, type TelemetryEndpoint } from "./config";
import { Outbox } from "./outbox";
import { type TelemetrySink, trace } from "./sink";

/** What {@link MixpanelSink.connect} needs to make a sink. */
export type MixpanelSettings = {
  readonly env: NodeJS.ProcessEnv;
  readonly token: string | undefined;
  readonly distinctId: string;
  readonly debug: boolean;
  /** Makes the Mixpanel client; defaults to the real one. A test seam. */
  readonly init?: (token: string, endpoint: TelemetryEndpoint) => MixpanelClient;
};

/** Sends events and profiles to the Mixpanel project a token names. */
export class MixpanelSink implements TelemetrySink {
  private readonly client: MixpanelClient;
  private readonly distinctId: string;
  private readonly debug: boolean;
  private readonly outbox = new Outbox();

  private constructor(client: MixpanelClient, distinctId: string, debug: boolean) {
    this.client = client;
    this.distinctId = distinctId;
    this.debug = debug;
  }

  /** A sink for the project the token names, or `undefined` when there is none or the client cannot be made. */
  static connect(settings: MixpanelSettings): MixpanelSink | undefined {
    if (!settings.token) {
      return undefined;
    }
    try {
      const init = settings.init ?? defaultInit;
      const client = init(settings.token, resolveTelemetryEndpoint(settings.env));
      return new MixpanelSink(client, settings.distinctId, settings.debug);
    } catch {
      return undefined;
    }
  }

  track(event: string, payload: Properties): void {
    trace(this.debug, () => {
      return `${event} ${JSON.stringify(payload)}`;
    });
    this.outbox.add(
      this.deliver((done) => {
        this.client.track(event, payload, done);
      }),
    );
  }

  profile(payload: Properties, modifiers: Modifiers): void {
    trace(this.debug, () => {
      return `people.set ${JSON.stringify(payload)}`;
    });
    this.outbox.add(
      this.deliver((done) => {
        this.client.people.set(this.distinctId, payload, modifiers, done);
      }),
    );
  }

  flush(timeoutMs: number): Promise<void> {
    return this.outbox.drain(timeoutMs);
  }

  /** Starts one send. It resolves when the client calls back, and also when the client throws. */
  private deliver(send: (done: () => void) => void): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        send(() => {
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }
}

/** Real Mixpanel client construction, kept apart so a test can swap it. */
function defaultInit(token: string, { host, path }: TelemetryEndpoint): MixpanelClient {
  return mixpanelLib.init(token, { host, path, geolocate: false });
}

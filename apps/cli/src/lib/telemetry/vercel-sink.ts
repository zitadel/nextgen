import type { Properties } from "mixpanel";

import { userAgent } from "@/lib/user-agent";

import { Outbox } from "./outbox";
import { type TelemetrySink, trace } from "./sink";
import { resolveVercelEndpoint, type VercelTarget, vercelEventBody } from "./vercel";

/** What {@link VercelSink.from} needs to make a sink. */
export type VercelSettings = {
  readonly env: NodeJS.ProcessEnv;
  /** The properties the copy keeps, in priority order. Without any there is no copy. */
  readonly keys: readonly string[] | undefined;
  readonly debug: boolean;
  /** Posts the copy. A test seam. */
  readonly fetch: typeof fetch;
};

/** Sends a copy of each event to Vercel Web Analytics. */
export class VercelSink implements TelemetrySink {
  private readonly target: VercelTarget;
  private readonly debug: boolean;
  private readonly post: typeof fetch;
  private readonly outbox = new Outbox();

  private constructor(target: VercelTarget, debug: boolean, post: typeof fetch) {
    this.target = target;
    this.debug = debug;
    this.post = post;
  }

  /** A sink for the copy, or `undefined` when there are no properties to keep or no intake to send them to. */
  static from(settings: VercelSettings): VercelSink | undefined {
    if (!settings.keys?.length) {
      return undefined;
    }
    const endpoint = resolveVercelEndpoint(settings.env);
    if (endpoint === undefined) {
      trace(settings.debug, () => {
        return "vercel: no copy on the development channel";
      });
      return undefined;
    }
    const target = { endpoint, keys: settings.keys };
    return new VercelSink(target, settings.debug, settings.fetch);
  }

  track(event: string, payload: Properties): void {
    const body = vercelEventBody(event, payload, this.target, Date.now());
    trace(this.debug, () => {
      return `vercel ${body}`;
    });
    this.outbox.add(this.deliver(body));
  }

  /** Web Analytics has no profiles. */
  profile(): void {}

  flush(timeoutMs: number): Promise<void> {
    return this.outbox.drain(timeoutMs);
  }

  /** Starts one send. It resolves when the intake answers, and also when the request fails. */
  private deliver(body: string): Promise<void> {
    return Promise.resolve()
      .then(() => {
        return this.post(this.target.endpoint, {
          method: "POST",
          // `x-va-server` is what `@vercel/analytics/server` sends.
          headers: {
            "content-type": "application/json",
            "user-agent": userAgent(),
            "x-va-server": "1",
          },
          body,
        });
      })
      .then(
        (response) => {
          trace(this.debug, () => {
            return `vercel answered ${response.status}`;
          });
        },
        () => {
          return undefined;
        },
      );
  }
}

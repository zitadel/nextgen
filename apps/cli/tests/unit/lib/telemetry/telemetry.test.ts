import type { Callback, Mixpanel as MixpanelClient, Modifiers, Properties } from "mixpanel";
import { describe, expect, it } from "vitest";

import { Telemetry, type TelemetryDeps } from "../../../../src/lib/telemetry";
import type { Identity } from "../../../../src/lib/telemetry/identity";

type Tracked = { event: string; properties: Properties };

function fakeClient(
  sink: Tracked[],
  opts: { throwOnTrack?: boolean; peopleSink?: Properties[] } = {},
): MixpanelClient {
  return {
    track(event: string, properties: Properties, callback?: Callback): void {
      if (opts.throwOnTrack) {
        throw new Error("boom");
      }
      sink.push({ event, properties });
      callback?.(undefined);
    },
    people: {
      set(
        _distinctId: string,
        properties: Properties,
        _modifiers?: Modifiers,
        callback?: Callback,
      ): void {
        opts.peopleSink?.push(properties);
        callback?.(undefined);
      },
      set_once(
        _distinctId: string,
        _properties: Properties,
        _modifiers?: Modifiers,
        callback?: Callback,
      ): void {
        callback?.(undefined);
      },
    },
  };
}

const identity: Identity = { distinctId: "did-123", isFirstRun: false };

function deps(sink: Tracked[], extra: Partial<TelemetryDeps> = {}): TelemetryDeps {
  let counter = 0;
  return {
    env: {},
    initClient: () => fakeClient(sink),
    loadIdentity: () => identity,
    newId: () => `id-${++counter}`,
    ...extra,
  };
}

describe("Telemetry (generic core)", () => {
  it("tracks an event, stamping distinct_id and $insert_id", () => {
    const sink: Tracked[] = [];
    const t = Telemetry.create(deps(sink));
    t.track("custom_event", { command: "setup", empty: "" });

    expect(t.enabled).toBe(true);
    expect(sink).toHaveLength(1);
    expect(sink[0]?.event).toBe("custom_event");
    expect(sink[0]?.properties.command).toBe("setup");
    expect(sink[0]?.properties.distinct_id).toBe("did-123");
    expect(sink[0]?.properties.$insert_id).toBeDefined();
    // compact() drops empty values.
    expect(sink[0]?.properties.empty).toBeUndefined();
  });

  it("never mutates the caller's property bag", () => {
    const sink: Tracked[] = [];
    const t = Telemetry.create(deps(sink));
    const input = Object.freeze({ command: "status" });
    expect(() => t.track("e", input)).not.toThrow();
    expect(input).toEqual({ command: "status" });
  });

  it("writes a profile via the People API", () => {
    const sink: Tracked[] = [];
    const peopleSink: Properties[] = [];
    const t = Telemetry.create(deps(sink, { initClient: () => fakeClient(sink, { peopleSink }) }));
    t.profile({ $name: "darwin · did-1234" }, { $ip: 0 });

    expect(peopleSink).toHaveLength(1);
    expect(peopleSink[0]?.$name).toBe("darwin · did-1234");
  });

  it("exposes the first-run flag from identity", () => {
    const t = Telemetry.create(deps([], { loadIdentity: () => ({ distinctId: "x", isFirstRun: true }) }));
    expect(t.isFirstRun).toBe(true);
  });

  it("is an inert no-op when opted out via flag", () => {
    const sink: Tracked[] = [];
    const t = Telemetry.create(deps(sink, { flag: false }));
    t.track("e", {});
    expect(t.enabled).toBe(false);
    expect(sink).toHaveLength(0);
  });

  it("is inert when consent is disabled via the environment", () => {
    const sink: Tracked[] = [];
    const t = Telemetry.create(deps(sink, { env: { DO_NOT_TRACK: "1" } }));
    t.track("e", {});
    expect(sink).toHaveLength(0);
  });

  it("fails open when the client constructor throws", () => {
    const sink: Tracked[] = [];
    const t = Telemetry.create(
      deps(sink, {
        initClient: () => {
          throw new Error("cannot init");
        },
      }),
    );
    expect(() => t.track("e", {})).not.toThrow();
    expect(sink).toHaveLength(0);
  });

  it("swallows a synchronous client.track throw", () => {
    const sink: Tracked[] = [];
    const t = Telemetry.create(deps(sink, { initClient: () => fakeClient(sink, { throwOnTrack: true }) }));
    expect(() => t.track("e", {})).not.toThrow();
  });

  it("shutdown resolves after pending sends complete", async () => {
    const sink: Tracked[] = [];
    const t = Telemetry.create(deps(sink));
    t.track("e", {});
    await expect(t.shutdown(50)).resolves.toBeUndefined();
  });
});

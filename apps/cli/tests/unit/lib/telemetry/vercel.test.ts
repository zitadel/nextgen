import type { Callback, Mixpanel as MixpanelClient, Properties } from "mixpanel";
import { describe, expect, it } from "vitest";

import { Telemetry } from "../../../../src/lib/telemetry";
import {
  resolveVercelEndpoint,
  VERCEL_ENDPOINT,
  VERCEL_MAX_PROPERTIES,
  vercelEventBody,
} from "../../../../src/lib/telemetry/vercel";

const sink = {
  endpoint: VERCEL_ENDPOINT,
  keys: ["command", "status", "missing", "nested", "empty"],
};

describe("vercelEventBody", () => {
  it("keeps the event's name and only listed primitive values", () => {
    const body = JSON.parse(
      vercelEventBody(
        "cli_command_completed",
        {
          command: "setup",
          status: "ok",
          nested: { a: 1 },
          empty: "",
          distinct_id: "did-1",
        } as unknown as Properties,
        sink,
        1_700_000_000_000,
      ),
    );
    expect(body).toEqual({
      o: "https://preview.zitadel.com",
      ts: 1_700_000_000_000,
      sdkn: "zitadel-cli",
      sdkv: "",
      r: "",
      en: "cli_command_completed",
      ed: { command: "setup", status: "ok" },
    });
  });

  it("keeps at most the intake's property limit, in key order", () => {
    const keys = Array.from({ length: 12 }, (_, i) => `k${i}`);
    const properties = Object.fromEntries(keys.map((key) => [key, 1]));
    const body = JSON.parse(
      vercelEventBody("e", properties, { endpoint: VERCEL_ENDPOINT, keys }, 0),
    );
    expect(Object.keys(body.ed)).toEqual(keys.slice(0, VERCEL_MAX_PROPERTIES));
  });

  it("gives a key that holds no value's place to the next one", () => {
    const keys = Array.from({ length: VERCEL_MAX_PROPERTIES + 1 }, (_, i) => `k${i}`);
    const properties = Object.fromEntries(keys.map((key) => [key, key === "k1" ? "" : 1]));
    const body = JSON.parse(
      vercelEventBody("e", properties, { endpoint: VERCEL_ENDPOINT, keys }, 0),
    );
    expect(Object.keys(body.ed)).toEqual(keys.filter((key) => key !== "k1"));
  });
});

describe("resolveVercelEndpoint", () => {
  it("sends production runs to the cloud's intake", () => {
    expect(resolveVercelEndpoint({})).toBe(VERCEL_ENDPOINT);
    expect(resolveVercelEndpoint({ ZITADEL_TELEMETRY_ENV: "production" })).toBe(VERCEL_ENDPOINT);
  });

  it("sends no copy on the development channel, CI included", () => {
    expect(resolveVercelEndpoint({ ZITADEL_TELEMETRY_ENV: "development" })).toBeUndefined();
    expect(resolveVercelEndpoint({ CI: "true" })).toBeUndefined();
    expect(resolveVercelEndpoint({ GITHUB_ACTIONS: "true" })).toBeUndefined();
  });

  it("lets an explicit production env win over the CI safeguard", () => {
    expect(resolveVercelEndpoint({ CI: "true", ZITADEL_TELEMETRY_ENV: "production" })).toBe(
      VERCEL_ENDPOINT,
    );
  });

  it("lets ZITADEL_TELEMETRY_VERCEL_ENDPOINT name an intake for any run", () => {
    const env = {
      ZITADEL_TELEMETRY_ENV: "development",
      ZITADEL_TELEMETRY_VERCEL_ENDPOINT: " https://intake.test/event ",
    };
    expect(resolveVercelEndpoint(env)).toBe("https://intake.test/event");
  });
});

describe("Telemetry's Vercel copy", () => {
  function create(
    vercelKeys: readonly string[] | undefined,
    { flag, env = {} }: { flag?: boolean; env?: NodeJS.ProcessEnv } = {},
  ) {
    const posts: { url: string; body: string }[] = [];
    const tracked: string[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      posts.push({ url, body: String(init?.body) });
      return new Response("OK");
    }) as typeof fetch;
    const client = {
      track: (event: string, _properties: unknown, callback?: Callback) => {
        tracked.push(event);
        callback?.(undefined);
      },
      people: { set: () => undefined, set_once: () => undefined },
    } as unknown as MixpanelClient;
    const telemetry = Telemetry.create({
      env,
      flag,
      vercelKeys,
      initClient: () => client,
      loadIdentity: () => ({ distinctId: "did-1", isFirstRun: false }),
      fetch: fetchFn,
    });
    return { telemetry, posts, tracked };
  }

  it("posts one copy per tracked event to the intake, under the event's name", async () => {
    const { telemetry, posts } = create(["command"]);
    telemetry.track("cli_command_started", { command: "doctor" });
    await telemetry.shutdown();
    expect(posts).toHaveLength(1);
    expect(posts[0]?.url).toBe(VERCEL_ENDPOINT);
    expect(JSON.parse(posts[0]?.body ?? "{}")).toMatchObject({
      en: "cli_command_started",
      ed: { command: "doctor" },
    });
  });

  it("sends the copy, and Mixpanel nothing, without a Mixpanel token", async () => {
    const { telemetry, posts, tracked } = create(["command"]);
    telemetry.track("cli_command_started", { command: "doctor" });
    await telemetry.shutdown();
    expect(posts).toHaveLength(1);
    expect(tracked).toEqual([]);
  });

  it("sends no copy without keys", async () => {
    const { telemetry, posts } = create(undefined);
    telemetry.track("cli_command_started", { command: "doctor" });
    await telemetry.shutdown();
    expect(posts).toHaveLength(0);
  });

  it("sends no copy when telemetry is off", async () => {
    const { telemetry, posts } = create(["command"], { flag: false });
    telemetry.track("cli_command_started", { command: "doctor" });
    await telemetry.shutdown();
    expect(posts).toHaveLength(0);
  });

  it("sends no copy on the development channel", async () => {
    const { telemetry, posts, tracked } = create(["command"], {
      env: { ZITADEL_TELEMETRY_ENV: "development", ZITADEL_TELEMETRY_TOKEN: "tok" },
    });
    telemetry.track("cli_command_started", { command: "doctor" });
    await telemetry.shutdown();
    expect(tracked).toEqual(["cli_command_started"]);
    expect(posts).toHaveLength(0);
  });

  it("is off on the development channel without a Mixpanel token", () => {
    const { telemetry } = create(["command"], { env: { ZITADEL_TELEMETRY_ENV: "development" } });
    expect(telemetry.enabled).toBe(false);
  });
});

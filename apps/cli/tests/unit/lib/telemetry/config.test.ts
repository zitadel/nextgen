import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveChannel,
  resolveTelemetryEndpoint,
  resolveTelemetryToken,
} from "../../../../src/lib/telemetry/config";

describe("resolveChannel", () => {
  it("defaults to production (single generic build, no channel stamp)", () => {
    expect(resolveChannel({})).toBe("production");
  });

  it("selects development on an explicit development env", () => {
    expect(resolveChannel({ ZITADEL_TELEMETRY_ENV: "development" })).toBe("development");
  });

  it("treats an unattended CI run as development, as a safeguard", () => {
    expect(resolveChannel({ CI: "true" })).toBe("development");
    expect(resolveChannel({ GITHUB_ACTIONS: "true" })).toBe("development");
  });

  it("ignores a falsey CI flag (CI=false is not a CI run)", () => {
    expect(resolveChannel({ CI: "false" })).toBe("production");
  });

  it("lets an explicit production env win over the CI safeguard", () => {
    expect(resolveChannel({ CI: "true", ZITADEL_TELEMETRY_ENV: "production" })).toBe("production");
  });

  it("trims surrounding whitespace on the channel env", () => {
    expect(resolveChannel({ ZITADEL_TELEMETRY_ENV: " development " })).toBe("development");
  });
});

describe("resolveTelemetryToken", () => {
  it("names no Mixpanel project on any channel while Mixpanel is paused", () => {
    for (const env of [
      {},
      { ZITADEL_TELEMETRY_ENV: "production" },
      { ZITADEL_TELEMETRY_ENV: "development" },
      { CI: "true" },
    ]) {
      expect(resolveTelemetryToken(env)).toBeUndefined();
    }
  });

  it("lets ZITADEL_TELEMETRY_TOKEN name one, trimmed", () => {
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_TOKEN: " custom " })).toBe("custom");
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_TOKEN: " " })).toBeUndefined();
  });
});

const CLOUD_PROXY = { host: "preview.zitadel.com", path: "/telemetry/mixpanel" };
const US_DIRECT = { host: "api.mixpanel.com", path: "" };

describe("resolveTelemetryEndpoint", () => {
  it("sends EU events (the Zitadel projects' region) through the cloud, US ones to Mixpanel", () => {
    expect(resolveTelemetryEndpoint({})).toEqual(CLOUD_PROXY);
    expect(resolveTelemetryEndpoint({ ZITADEL_TELEMETRY_REGION: "us" })).toEqual(US_DIRECT);
    expect(resolveTelemetryEndpoint({ ZITADEL_TELEMETRY_REGION: "EU" })).toEqual(CLOUD_PROXY);
  });

  it("trims surrounding whitespace on the region env", () => {
    expect(resolveTelemetryEndpoint({ ZITADEL_TELEMETRY_REGION: " us " })).toEqual(US_DIRECT);
  });

  // Released CLIs send to this path, so the cloud has to keep forwarding it.
  it("matches the cloud's rewrite to Mixpanel's EU host, ahead of the server's catch-all", async () => {
    const vercelJson = join(import.meta.dirname, "../../../../../../vercel.json");
    const { rewrites } = JSON.parse(await readFile(vercelJson, "utf8")) as {
      rewrites: { source: string; destination: unknown }[];
    };
    const proxy = rewrites.findIndex(
      ({ source, destination }) =>
        source === `${resolveTelemetryEndpoint({}).path}/:path(.*)` &&
        destination === "https://api-eu.mixpanel.com/:path",
    );
    expect(proxy, "vercel.json has no rewrite for the CLI's Mixpanel path").toBeGreaterThanOrEqual(
      0,
    );
    expect(proxy).toBeLessThan(rewrites.findIndex(({ source }) => source === "/(.*)"));
  });
});

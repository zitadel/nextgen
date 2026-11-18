import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveChannel,
  resolveTelemetryEndpoint,
  resolveTelemetryToken,
} from "@/lib/telemetry/config";

describe("resolveChannel", () => {
  // Tests run from a checkout of the source, which is never customer traffic.
  it("treats a run from a source checkout as development", () => {
    expect(resolveChannel({})).toBe("development");
  });

  it("selects development on an explicit development env", () => {
    expect(resolveChannel({ ZITADEL_TELEMETRY_ENV: "development" })).toBe("development");
  });

  it("treats an unattended CI run as development, as a safeguard", () => {
    expect(resolveChannel({ CI: "true" })).toBe("development");
    expect(resolveChannel({ GITHUB_ACTIONS: "true" })).toBe("development");
  });

  it("ignores a falsey CI flag (CI=false is not a CI run)", () => {
    expect(resolveChannel({ CI: "false", ZITADEL_TELEMETRY_ENV: "production" })).toBe("production");
  });

  it("treats the CLI's own development mode as development", () => {
    expect(resolveChannel({ ZITADEL_CLI_DEV: "1" })).toBe("development");
    expect(resolveChannel({ ZITADEL_CLI_DEV: "0", ZITADEL_TELEMETRY_ENV: "production" })).toBe(
      "production",
    );
  });

  it("lets an explicit production env win over the CI safeguard", () => {
    expect(resolveChannel({ CI: "true", ZITADEL_TELEMETRY_ENV: "production" })).toBe("production");
  });

  it("trims surrounding whitespace on the channel env", () => {
    expect(resolveChannel({ ZITADEL_TELEMETRY_ENV: " development " })).toBe("development");
  });
});

const PRODUCTION_TOKEN = "f56fd7315ccd614fba8eecb2a8966152";
const DEVELOPMENT_TOKEN = "0fb432b08a9797b87b0eebcbee11706e";

describe("resolveTelemetryToken", () => {
  it("names the production project on the production channel", () => {
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_ENV: "production" })).toBe(PRODUCTION_TOKEN);
  });

  it("names the development project on the development channel", () => {
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_ENV: "development" })).toBe(DEVELOPMENT_TOKEN);
    expect(resolveTelemetryToken({ ZITADEL_CLI_DEV: "1" })).toBe(DEVELOPMENT_TOKEN);
  });

  it("names no project for a run in CI, which sends nothing", () => {
    expect(resolveTelemetryToken({ CI: "true" })).toBeUndefined();
    expect(resolveTelemetryToken({ GITHUB_ACTIONS: "true" })).toBeUndefined();
  });

  it("lets ZITADEL_TELEMETRY_TOKEN name one, trimmed, even in CI", () => {
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_TOKEN: " custom ", CI: "true" })).toBe(
      "custom",
    );
  });
});

const CLOUD_PROXY = { host: "preview.zitadel.com", path: "/telemetry/mixpanel" };
const US_DIRECT = { host: "api.mixpanel.com", path: "" };

describe("resolveTelemetryEndpoint", () => {
  it("sends each project's events to the region it lives in: production US, development EU", () => {
    expect(resolveTelemetryEndpoint({ ZITADEL_TELEMETRY_ENV: "production" })).toEqual(US_DIRECT);
    expect(resolveTelemetryEndpoint({ ZITADEL_TELEMETRY_ENV: "development" })).toEqual(CLOUD_PROXY);
  });

  it("lets ZITADEL_TELEMETRY_REGION name the region, and takes a token of one's own as EU", () => {
    expect(resolveTelemetryEndpoint({ ZITADEL_TELEMETRY_TOKEN: "own" })).toEqual(CLOUD_PROXY);
    expect(resolveTelemetryEndpoint({ ZITADEL_TELEMETRY_REGION: "us" })).toEqual(US_DIRECT);
    expect(resolveTelemetryEndpoint({ ZITADEL_TELEMETRY_REGION: "EU" })).toEqual(CLOUD_PROXY);
  });

  it("trims surrounding whitespace on the region env", () => {
    expect(resolveTelemetryEndpoint({ ZITADEL_TELEMETRY_REGION: " us " })).toEqual(US_DIRECT);
  });

  // Released CLIs send to this path, so the cloud has to keep forwarding it.
  it("matches the cloud's rewrite to Mixpanel's EU host, ahead of the catch-all", async () => {
    const vercelJson = join(import.meta.dirname, "../../../../../../vercel.json");
    const { rewrites } = JSON.parse(await readFile(vercelJson, "utf8")) as {
      rewrites: {
        source: string;
        has?: { type: string; value?: string }[];
        destination: unknown;
      }[];
    };
    const proxy = rewrites.findIndex(
      ({ source, destination }) =>
        source === `${resolveTelemetryEndpoint({}).path}/:path(.*)` &&
        destination === "https://api-eu.mixpanel.com/:path",
    );
    expect(proxy, "vercel.json has no rewrite for the CLI's Mixpanel path").toBeGreaterThanOrEqual(
      0,
    );
    // The catch-all is the first `/(.*)` on the cloud's own host: only
    // go.zitadel.com's rule is another host's; any other condition, a host
    // naming another host included, still counts as the cloud's.
    expect(proxy).toBeLessThan(
      rewrites.findIndex(
        ({ source, has }) =>
          source === "/(.*)" &&
          !has?.some(({ type, value }) => type === "host" && value === "go.zitadel.com"),
      ),
    );
  });
});

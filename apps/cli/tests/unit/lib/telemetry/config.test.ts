import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  resolveTelemetryEndpoint,
  resolveTelemetryToken,
} from "../../../../src/lib/telemetry/config";

const DEV_TOKEN = "0fb432b08a9797b87b0eebcbee11706e";
const PROD_TOKEN = "f56fd7315ccd614fba8eecb2a8966152";

describe("resolveTelemetryToken", () => {
  it("defaults to the prod project (single generic build, no channel stamp)", () => {
    expect(resolveTelemetryToken({})).toBe(PROD_TOKEN);
  });

  it("selects the dev project on an explicit development env", () => {
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_ENV: "development" })).toBe(DEV_TOKEN);
  });

  it("selects prod on an explicit production env", () => {
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_ENV: "production" })).toBe(PROD_TOKEN);
  });

  it("routes an unattended CI run to the dev project as a safeguard", () => {
    expect(resolveTelemetryToken({ CI: "true" })).toBe(DEV_TOKEN);
    expect(resolveTelemetryToken({ GITHUB_ACTIONS: "true" })).toBe(DEV_TOKEN);
  });

  it("ignores a falsey CI flag (CI=false is not a CI run)", () => {
    expect(resolveTelemetryToken({ CI: "false" })).toBe(PROD_TOKEN);
  });

  it("lets an explicit production env win over the CI safeguard", () => {
    expect(resolveTelemetryToken({ CI: "true", ZITADEL_TELEMETRY_ENV: "production" })).toBe(
      PROD_TOKEN,
    );
  });

  it("lets ZITADEL_TELEMETRY_TOKEN override the channel outright", () => {
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_TOKEN: "custom" })).toBe("custom");
  });

  it("trims surrounding whitespace on the channel env", () => {
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_ENV: " production " })).toBe(PROD_TOKEN);
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

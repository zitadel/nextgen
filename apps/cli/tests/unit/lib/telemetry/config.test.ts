import { describe, expect, it } from "vitest";

import { resolveTelemetryHost, resolveTelemetryToken } from "../../../../src/lib/telemetry/config";

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

describe("resolveTelemetryHost", () => {
  it("defaults to the EU host (the Zitadel projects' region) and switches to US on request", () => {
    expect(resolveTelemetryHost({})).toBe("api-eu.mixpanel.com");
    expect(resolveTelemetryHost({ ZITADEL_TELEMETRY_REGION: "us" })).toBe("api.mixpanel.com");
    expect(resolveTelemetryHost({ ZITADEL_TELEMETRY_REGION: "EU" })).toBe("api-eu.mixpanel.com");
  });

  it("trims surrounding whitespace on the region env", () => {
    expect(resolveTelemetryHost({ ZITADEL_TELEMETRY_REGION: " us " })).toBe("api.mixpanel.com");
  });
});

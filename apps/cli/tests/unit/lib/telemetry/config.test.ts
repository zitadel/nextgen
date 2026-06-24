import { describe, expect, it } from "vitest";

import {
  resolveTelemetryHost,
  resolveTelemetryToken,
} from "../../../../src/lib/telemetry/config";

const DEV_TOKEN = "0fb432b08a9797b87b0eebcbee11706e";
const PROD_TOKEN = "f56fd7315ccd614fba8eecb2a8966152";

describe("resolveTelemetryToken", () => {
  it("defaults to the dev project when running from source (no build stamp)", () => {
    expect(resolveTelemetryToken({})).toBe(DEV_TOKEN);
  });

  it("uses the prod project under the production build-channel stamp", () => {
    // The CI/release override path; install-location auto-detection can't be
    // exercised in-source (the test file is not under node_modules).
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_BUILD_CHANNEL: "production" })).toBe(
      PROD_TOKEN,
    );
  });

  it("lets an explicit development env override a production build stamp", () => {
    expect(
      resolveTelemetryToken({
        ZITADEL_TELEMETRY_BUILD_CHANNEL: "production",
        ZITADEL_TELEMETRY_ENV: "development",
      }),
    ).toBe(DEV_TOKEN);
  });

  it("selects prod on an explicit production env", () => {
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_ENV: "production" })).toBe(PROD_TOKEN);
  });

  it("lets ZITADEL_TELEMETRY_TOKEN override the channel outright", () => {
    expect(resolveTelemetryToken({ ZITADEL_TELEMETRY_TOKEN: "custom" })).toBe("custom");
  });
});

describe("resolveTelemetryHost", () => {
  it("defaults to the EU host (the Zitadel projects' region) and switches to US on request", () => {
    expect(resolveTelemetryHost({})).toBe("api-eu.mixpanel.com");
    expect(resolveTelemetryHost({ ZITADEL_TELEMETRY_REGION: "us" })).toBe("api.mixpanel.com");
    expect(resolveTelemetryHost({ ZITADEL_TELEMETRY_REGION: "EU" })).toBe("api-eu.mixpanel.com");
  });
});

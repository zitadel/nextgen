import { describe, expect, it } from "vitest";

import { TelemetryError, TelemetryHomeUnknownError } from "@/lib/telemetry";

describe("TelemetryError", () => {
  it.each([
    ["a client that failed", new TelemetryError("no token", new Error("no token"))],
    ["a home it cannot find", new TelemetryHomeUnknownError("no token", new Error("no token"))],
  ])("reports the error %s stands for", (_situation, error) => {
    expect(error).toMatchObject({
      code: "E_VALIDATION",
      details: { original: { name: "Error", message: "no token" } },
    });
  });
});

import { describe, expect, it } from "vitest";

import { country } from "../../../../../src/lib/telemetry/dimensions/country";

describe("country", () => {
  it("resolves a known IANA zone to its ISO country code", () => {
    expect(country.value("Australia/Sydney")).toBe("AU");
    expect(country.value("America/New_York")).toBe("US");
    expect(country.value("Europe/London")).toBe("GB");
  });

  it("returns undefined for an unknown or empty zone rather than guessing", () => {
    expect(country.value("Mars/Olympus_Mons")).toBeUndefined();
    expect(country.value("")).toBeUndefined();
  });
});

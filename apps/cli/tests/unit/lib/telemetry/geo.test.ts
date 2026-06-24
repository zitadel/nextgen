import { describe, expect, it } from "vitest";

import { country, operatingSystem } from "../../../../src/lib/telemetry/geo";

describe("operatingSystem", () => {
  it("maps platforms to Mixpanel's canonical OS labels", () => {
    expect(operatingSystem.value("darwin")).toBe("Mac OS X");
    expect(operatingSystem.value("win32")).toBe("Windows");
    expect(operatingSystem.value("linux")).toBe("Linux");
  });

  it("falls back to the raw platform for unknown values", () => {
    expect(operatingSystem.value("android" as NodeJS.Platform)).toBe("android");
  });
});

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

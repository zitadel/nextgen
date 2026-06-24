import { describe, expect, it } from "vitest";

import { countryFromTimezone, osName } from "../../../../src/lib/telemetry/geo";

describe("osName", () => {
  it("maps platforms to Mixpanel's canonical OS labels", () => {
    expect(osName("darwin")).toBe("Mac OS X");
    expect(osName("win32")).toBe("Windows");
    expect(osName("linux")).toBe("Linux");
  });

  it("falls back to the raw platform for unknown values", () => {
    expect(osName("android" as NodeJS.Platform)).toBe("android");
  });
});

describe("countryFromTimezone", () => {
  it("resolves a known IANA zone to its ISO country code", () => {
    expect(countryFromTimezone("Australia/Sydney")).toBe("AU");
    expect(countryFromTimezone("America/New_York")).toBe("US");
    expect(countryFromTimezone("Europe/London")).toBe("GB");
  });

  it("returns undefined for an unknown or empty zone rather than guessing", () => {
    expect(countryFromTimezone("Mars/Olympus_Mons")).toBeUndefined();
    expect(countryFromTimezone("")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { operatingSystem } from "../../../../../src/lib/telemetry/dimensions/operating-system";

describe("operatingSystem", () => {
  it("maps platforms to Mixpanel's canonical OS labels", () => {
    expect(operatingSystem.value("darwin")).toBe("Mac OS X");
    expect(operatingSystem.value("win32")).toBe("Windows");
    expect(operatingSystem.value("linux")).toBe("Linux");
    expect(operatingSystem.value("freebsd")).toBe("BSD");
  });

  it("falls back to the raw platform for unknown values", () => {
    expect(operatingSystem.value("android" as NodeJS.Platform)).toBe("android");
  });
});

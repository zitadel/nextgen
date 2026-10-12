import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../src/lib/errors";
import { formatTtl, parseTtl } from "../../../src/lib/ttl";

describe("parseTtl", () => {
  it("keeps a whole unit as it is written", () => {
    expect(parseTtl("7d")).toEqual({ canonical: "7d", ms: 7 * 24 * 60 * 60 * 1000 });
    expect(parseTtl("12h")).toEqual({ canonical: "12h", ms: 12 * 60 * 60 * 1000 });
    expect(parseTtl("90m")).toEqual({ canonical: "90m", ms: 90 * 60 * 1000 });
  });

  it("re-expresses seconds in the coarsest exact unit", () => {
    expect(parseTtl("3600s").canonical).toBe("1h");
    expect(parseTtl("86400s").canonical).toBe("1d");
    expect(parseTtl("120s").canonical).toBe("2m");
  });

  it("rounds seconds that are not a whole minute up to the next minute", () => {
    expect(parseTtl("90s").canonical).toBe("2m");
  });

  it("refuses a value that is not a whole number of s, m, h or d", () => {
    expect(() => parseTtl("7")).toThrow(ZitadelError);
    expect(() => parseTtl("1w")).toThrow(ZitadelError);
    expect(() => parseTtl("0d")).toThrow(ZitadelError);
    expect(() => parseTtl("1.5h")).toThrow(ZitadelError);
  });
});

describe("formatTtl", () => {
  it("picks the coarsest unit that divides the duration exactly", () => {
    expect(formatTtl(7 * 24 * 60 * 60)).toBe("7d");
    expect(formatTtl(12 * 60 * 60)).toBe("12h");
    expect(formatTtl(90 * 60)).toBe("90m");
  });

  it("rounds a sub-minute remainder up to the next whole minute", () => {
    expect(formatTtl(90)).toBe("2m");
    expect(formatTtl(60)).toBe("1m");
  });
});

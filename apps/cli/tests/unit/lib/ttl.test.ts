import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../src/lib/errors";
import { formatTtl, isoDuration, parseTtl } from "../../../src/lib/ttl";

describe("parseTtl", () => {
  it("keeps a whole unit as it is written", () => {
    expect(parseTtl("7d")).toEqual({ canonical: "7d", iso: "P7D", ms: 7 * 24 * 60 * 60 * 1000 });
    expect(parseTtl("12h")).toEqual({ canonical: "12h", iso: "PT12H", ms: 12 * 60 * 60 * 1000 });
    expect(parseTtl("90m")).toEqual({ canonical: "90m", iso: "PT90M", ms: 90 * 60 * 1000 });
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

describe("isoDuration", () => {
  it("writes whole days as a date-part duration", () => {
    expect(isoDuration(7 * 24 * 60 * 60)).toBe("P7D");
    expect(isoDuration(24 * 60 * 60)).toBe("P1D");
  });

  it("writes anything shorter in the coarsest exact time part", () => {
    expect(isoDuration(12 * 60 * 60)).toBe("PT12H");
    expect(isoDuration(90 * 60)).toBe("PT90M");
  });

  it("rounds a sub-minute remainder up, matching the canonical string", () => {
    expect(isoDuration(90)).toBe("PT2M");
    expect(parseTtl("90s")).toEqual({ canonical: "2m", iso: "PT2M", ms: 90_000 });
  });

  it("is the form the wire carries for a parsed ttl", () => {
    expect(parseTtl("168h").iso).toBe("P7D");
    expect(parseTtl("3600s").iso).toBe("PT1H");
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

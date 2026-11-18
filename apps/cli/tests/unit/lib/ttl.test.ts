import { describe, expect, it } from "vitest";

import { Ttl, TtlError } from "@/lib/ttl";
import { thrownBy } from "@tests/helpers/thrown-value";

describe("Ttl.parse", () => {
  it("keeps a whole unit as it is written", () => {
    expect(Ttl.parse("7d")).toMatchObject({
      canonical: "7d",
      iso: "P7D",
      ms: 7 * 24 * 60 * 60 * 1000,
    });
    expect(Ttl.parse("12h")).toMatchObject({
      canonical: "12h",
      iso: "PT12H",
      ms: 12 * 60 * 60 * 1000,
    });
    expect(Ttl.parse("90m")).toMatchObject({ canonical: "90m", iso: "PT90M", ms: 90 * 60 * 1000 });
  });

  it("re-expresses seconds in the coarsest exact unit", () => {
    expect(Ttl.parse("3600s").canonical).toBe("1h");
    expect(Ttl.parse("86400s").canonical).toBe("1d");
    expect(Ttl.parse("120s").canonical).toBe("2m");
  });

  it("rounds seconds that are not a whole minute up to the next minute", () => {
    expect(Ttl.parse("90s").canonical).toBe("2m");
  });

  it("refuses a value that is not a whole number of s, m, h or d", () => {
    expect(() => Ttl.parse("7")).toThrow(TtlError);
    expect(() => Ttl.parse("1w")).toThrow(TtlError);
    expect(() => Ttl.parse("0d")).toThrow(TtlError);
    expect(() => Ttl.parse("1.5h")).toThrow(TtlError);
  });
});

describe("TtlError", () => {
  it("carries the words a caller shows, and is not a product error", () => {
    const error = thrownBy(() => {
      return Ttl.parse("1w");
    });

    expect(error).toBeInstanceOf(TtlError);
    expect(error).toMatchObject({
      message: "1w is not a valid ttl",
      hint: "Use a whole number followed by s, m, h or d, e.g. 7d, 12h or 90m.",
    });
  });
});

describe("Ttl.isoDuration", () => {
  it("writes whole days as a date-part duration", () => {
    expect(Ttl.isoDuration(7 * 24 * 60 * 60)).toBe("P7D");
    expect(Ttl.isoDuration(24 * 60 * 60)).toBe("P1D");
  });

  it("writes anything shorter in the coarsest exact time part", () => {
    expect(Ttl.isoDuration(12 * 60 * 60)).toBe("PT12H");
    expect(Ttl.isoDuration(90 * 60)).toBe("PT90M");
  });

  it("rounds a sub-minute remainder up, matching the canonical string", () => {
    expect(Ttl.isoDuration(90)).toBe("PT2M");
    expect(Ttl.parse("90s")).toMatchObject({ canonical: "2m", iso: "PT2M", ms: 90_000 });
  });

  it("is the form the wire carries for a parsed ttl", () => {
    expect(Ttl.parse("168h").iso).toBe("P7D");
    expect(Ttl.parse("3600s").iso).toBe("PT1H");
  });
});

describe("Ttl.format", () => {
  it("picks the coarsest unit that divides the duration exactly", () => {
    expect(Ttl.format(7 * 24 * 60 * 60)).toBe("7d");
    expect(Ttl.format(12 * 60 * 60)).toBe("12h");
    expect(Ttl.format(90 * 60)).toBe("90m");
  });

  it("rounds a sub-minute remainder up to the next whole minute", () => {
    expect(Ttl.format(90)).toBe("2m");
    expect(Ttl.format(60)).toBe("1m");
  });
});

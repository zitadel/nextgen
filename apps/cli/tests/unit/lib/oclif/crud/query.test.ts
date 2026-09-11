import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../../src/lib/errors";
import { parseFilter, parseSort } from "../../../../../src/lib/oclif/crud";

const FIELDS = ["created_at", "status"] as const;
const OPERATIONS = ["equals", "not_equals", "contains", "greater_than"] as const;

describe("parseFilter", () => {
  it("defaults the operation to equals", () => {
    expect(parseFilter("status=active", FIELDS, OPERATIONS)).toEqual({
      field: "status",
      operation: "equals",
      value: "active",
    });
  });

  it("splits an explicit operation from the value", () => {
    expect(parseFilter("created_at=greater_than:2026-01-01T00:00:00Z", FIELDS, OPERATIONS)).toEqual(
      {
        field: "created_at",
        operation: "greater_than",
        value: "2026-01-01T00:00:00Z",
      },
    );
  });

  it("keeps colons inside the value once the operation is consumed", () => {
    expect(parseFilter("status=equals:a:b", FIELDS, OPERATIONS)).toEqual({
      field: "status",
      operation: "equals",
      value: "a:b",
    });
  });

  it("treats an unknown prefix as part of an equals value", () => {
    expect(parseFilter("status=urn:x", FIELDS, OPERATIONS)).toEqual({
      field: "status",
      operation: "equals",
      value: "urn:x",
    });
  });

  it("keeps equals signs inside the value", () => {
    expect(parseFilter("status=a=b", FIELDS, OPERATIONS).value).toBe("a=b");
  });

  it("requires an operation to carry a value", () => {
    expect(parseFilter("status=contains", FIELDS, OPERATIONS)).toEqual({
      field: "status",
      operation: "equals",
      value: "contains",
    });
  });

  it("refuses a near-miss of a real operation instead of filtering for it literally", () => {
    expect(() => parseFilter("status=contians:active", FIELDS, OPERATIONS)).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: 'Unknown filter operation "contians"',
        hint: expect.stringContaining("Did you mean contains?"),
      }),
    );
  });

  it("keeps a colon-bearing value that resembles no operation", () => {
    expect(parseFilter("status=https://example.com/x.json", FIELDS, OPERATIONS)).toEqual({
      field: "status",
      operation: "equals",
      value: "https://example.com/x.json",
    });
    expect(parseFilter("created_at=2026-01-01T00:00:00Z", FIELDS, OPERATIONS).value).toBe(
      "2026-01-01T00:00:00Z",
    );
  });

  it.each(["nonsense", "=x", ""])("rejects %j with E_VALIDATION and a hint", (raw) => {
    expect(() => parseFilter(raw, FIELDS, OPERATIONS)).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        hint: expect.stringContaining("created_at=equals:"),
      }),
    );
    expect(() => parseFilter(raw, FIELDS, OPERATIONS)).toThrow(ZitadelError);
  });
});

describe("parseSort", () => {
  it("parses field:direction", () => {
    expect(parseSort("created_at:desc", FIELDS)).toEqual({
      field: "created_at",
      direction: "desc",
    });
  });

  it("defaults the direction to asc", () => {
    expect(parseSort("created_at", FIELDS)).toEqual({ field: "created_at", direction: "asc" });
  });

  it("refuses a trailing segment rather than sorting on a guess", () => {
    expect(() => parseSort("created_at:desc:typo", FIELDS)).toThrowError(
      expect.objectContaining({ code: "E_VALIDATION", message: 'Invalid --sort "created_at:desc:typo"' }),
    );
  });

  it("rejects an empty field with E_VALIDATION and a hint", () => {
    expect(() => parseSort(":desc", FIELDS)).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        hint: expect.stringContaining("created_at:desc"),
      }),
    );
  });
});

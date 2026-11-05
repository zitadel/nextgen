import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../../../src/lib/errors";
import { parseFilter, parseSort } from "../../../../../src/lib/oclif/crud";

const OPERATIONS = ["equals", "not_equals", "contains", "greater_than"] as const;
/** Every operation the platform knows; the fields offer only some. */
const KNOWN = [...OPERATIONS, "less_than"];
const SORTS = ["created_at", "status"] as const;
const FIELDS = [
  { field: "created_at", operations: OPERATIONS },
  { field: "status", operations: OPERATIONS },
] as const;

describe("parseFilter", () => {
  it("refuses an operation the platform knows but the field does not offer", () => {
    expect(() => parseFilter("status=less_than:active", FIELDS, KNOWN)).toThrowError(
      'Filter field "status" does not support the less_than operation',
    );
  });

  it("reads a word no operation is called as part of an equals value", () => {
    expect(parseFilter("status=starts_with:ab", FIELDS, KNOWN)).toEqual({
      field: FIELDS[1],
      operation: "equals",
      value: "starts_with:ab",
    });
  });

  it("defaults the operation to equals", () => {
    expect(parseFilter("status=active", FIELDS, KNOWN)).toEqual({
      field: expect.objectContaining({ field: "status" }),
      operation: "equals",
      value: "active",
    });
  });

  it("splits an explicit operation from the value", () => {
    expect(parseFilter("created_at=greater_than:2026-01-01T00:00:00Z", FIELDS, KNOWN)).toEqual({
      field: expect.objectContaining({ field: "created_at" }),
      operation: "greater_than",
      value: "2026-01-01T00:00:00Z",
    });
  });

  it("keeps colons inside the value once the operation is consumed", () => {
    expect(parseFilter("status=equals:a:b", FIELDS, KNOWN)).toEqual({
      field: expect.objectContaining({ field: "status" }),
      operation: "equals",
      value: "a:b",
    });
  });

  it("treats an unknown prefix as part of an equals value", () => {
    expect(parseFilter("status=urn:x", FIELDS, KNOWN)).toEqual({
      field: expect.objectContaining({ field: "status" }),
      operation: "equals",
      value: "urn:x",
    });
  });

  it("keeps equals signs inside the value", () => {
    expect(parseFilter("status=a=b", FIELDS, KNOWN).value).toBe("a=b");
  });

  it("requires an operation to carry a value", () => {
    expect(parseFilter("status=contains", FIELDS, KNOWN)).toEqual({
      field: expect.objectContaining({ field: "status" }),
      operation: "equals",
      value: "contains",
    });
  });

  it("refuses a near-miss of a real operation instead of filtering for it literally", () => {
    expect(() => parseFilter("status=contians:active", FIELDS, KNOWN)).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: 'Unknown filter operation "contians"',
        hint: expect.stringContaining("Did you mean contains?"),
      }),
    );
  });

  it("keeps a colon-bearing value that resembles no operation", () => {
    expect(parseFilter("status=https://example.com/x.json", FIELDS, KNOWN)).toEqual({
      field: expect.objectContaining({ field: "status" }),
      operation: "equals",
      value: "https://example.com/x.json",
    });
    expect(parseFilter("created_at=2026-01-01T00:00:00Z", FIELDS, KNOWN).value).toBe(
      "2026-01-01T00:00:00Z",
    );
  });

  it.each(["nonsense", "=x", ""])("rejects %j with E_VALIDATION and a hint", (raw) => {
    expect(() => parseFilter(raw, FIELDS, KNOWN)).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        hint: expect.stringContaining("created_at=equals:"),
      }),
    );
    expect(() => parseFilter(raw, FIELDS, KNOWN)).toThrow(ZitadelError);
  });
});

describe("parseSort", () => {
  it("parses field:direction", () => {
    expect(parseSort("created_at:desc", SORTS)).toEqual({
      field: "created_at",
      direction: "desc",
    });
  });

  it("defaults the direction to asc", () => {
    expect(parseSort("created_at", SORTS)).toEqual({ field: "created_at", direction: "asc" });
  });

  it("refuses a trailing segment rather than sorting on a guess", () => {
    expect(() => parseSort("created_at:desc:typo", SORTS)).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: 'Invalid --sort "created_at:desc:typo"',
      }),
    );
  });

  it("rejects an empty field with E_VALIDATION and a hint", () => {
    expect(() => parseSort(":desc", SORTS)).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        hint: expect.stringContaining("created_at:desc"),
      }),
    );
  });
});

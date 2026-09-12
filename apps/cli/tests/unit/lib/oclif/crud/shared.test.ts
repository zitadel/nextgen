import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  capitalize,
  dryRunResult,
  idArg,
  parseOrThrow,
} from "../../../../../src/lib/oclif/crud/shared";

describe("parseOrThrow", () => {
  const schema = z.object({ name: z.string() }).strict();

  it("returns the parsed value on success", () => {
    expect(parseOrThrow(schema, { name: "x" }, "bad")).toEqual({ name: "x" });
  });

  it("throws E_VALIDATION with the issues, message, and hint on failure", () => {
    expect(() =>
      parseOrThrow(schema, { name: 1, extra: true }, "Body does not match", "Fields: name"),
    ).toThrowError(
      expect.objectContaining({
        code: "E_VALIDATION",
        message: "Body does not match",
        hint: "Fields: name",
        details: { issues: expect.arrayContaining([expect.objectContaining({ path: ["name"] })]) },
      }),
    );
  });
});

describe("dryRunResult", () => {
  it("describes a write with its body", () => {
    const result = dryRunResult("create", "users", undefined, { schema: "s" });
    expect(result).toMatchObject({
      status: "ok",
      data: { dry_run: true, verb: "create", topic: "users", body: { schema: "s" } },
    });
    expect(result.pretty).toBe('Dry run: would create users\n{\n  "schema": "s"\n}');
  });

  it("describes a delete by id without a body", () => {
    expect(dryRunResult("revoke", "sessions", "sess_1").pretty).toBe(
      "Dry run: would revoke sessions sess_1",
    );
  });
});

describe("dryRunResult redaction", () => {
  it("masks a credential that reached the body legitimately, from a file", () => {
    const result = dryRunResult("create", "users", undefined, {
      schema: "sch_1",
      attributes: { email: "a@b.c", password: "hunter2", tags: [{ token: "t" }] },
    });
    expect(result.data).toEqual({
      dry_run: true,
      verb: "create",
      topic: "users",
      id: undefined,
      body: {
        schema: "sch_1",
        attributes: { email: "a@b.c", password: "«redacted»", tags: [{ token: "«redacted»" }] },
      },
    });
    expect(result.pretty).not.toContain("hunter2");
  });
});

describe("idArg", () => {
  it("declares a required positional named after the resource", () => {
    const args = idArg({ singular: "user", idField: "id", columns: [] });
    expect(args.id.required).toBe(true);
    expect(args.id.description).toBe("user id");
  });
});

describe("capitalize", () => {
  it("upper-cases the first character only", () => {
    expect(capitalize("revoke")).toBe("Revoke");
    expect(capitalize("")).toBe("");
  });
});

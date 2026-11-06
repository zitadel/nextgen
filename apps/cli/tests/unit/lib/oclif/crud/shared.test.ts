import { describe, expect, it } from "vitest";
import { z } from "zod";

import { article, capitalize, dryRunResult, idArg, parseOrThrow } from "@/lib/oclif/crud/shared";

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
    const result = dryRunResult({ verb: "create", topic: "users", body: { schema: "s" } });
    expect(result).toMatchObject({
      status: "ok",
      data: { dry_run: true, verb: "create", topic: "users", body: { schema: "s" } },
    });
    expect(result.pretty?.text).toBe('Dry run: would create users\n{\n  "schema": "s"\n}');
  });

  it("reports what the server answered when it was asked", () => {
    const result = dryRunResult({
      verb: "update",
      topic: "users",
      id: "user_1",
      body: { schema: "s" },
      checked: { id: "user_1", schema: "s" },
    });
    expect(result.data).toMatchObject({ result: { id: "user_1", schema: "s" } });
    expect(result.pretty?.text).toBe(
      'Dry run: would update users user_1\n{\n  "schema": "s"\n}\nThe server would accept this. Nothing changed.',
    );
  });

  it("masks a credential in the server's answer as it does in the body", () => {
    const result = dryRunResult({
      verb: "update",
      topic: "users",
      id: "user_1",
      checked: { attributes: { password: "hunter2" } },
    });
    expect(JSON.stringify(result.data)).not.toContain("hunter2");
  });

  it("leaves the answer out when the server was not asked", () => {
    expect(dryRunResult({ verb: "create", topic: "users" }).data).not.toHaveProperty("result");
  });

  it("describes a delete by id without a body", () => {
    expect(dryRunResult({ verb: "revoke", topic: "sessions", id: "sess_1" }).pretty?.text).toBe(
      "Dry run: would revoke sessions sess_1",
    );
  });

  it("spells the body the way JSON does, so the block a reader copies parses", () => {
    const result = dryRunResult({
      verb: "create",
      topic: "users",
      body: { attributes: { nickname: "a\u009bb" } },
    });

    const document = result.pretty?.text.slice(result.pretty.text.indexOf("\n") + 1) ?? "";
    expect(document).not.toContain("\u009b");
    expect(JSON.parse(document)).toEqual({ attributes: { nickname: "a\u009bb" } });
  });
});

describe("dryRunResult redaction", () => {
  it("masks a credential that reached the body legitimately, from a file", () => {
    const result = dryRunResult({
      verb: "create",
      topic: "users",
      body: {
        schema: "sch_1",
        attributes: { email: "a@b.c", password: "hunter2", tags: [{ token: "t" }] },
      },
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
    expect(result.pretty?.text).not.toContain("hunter2");
  });
});

describe("idArg", () => {
  it("declares a required positional named after the resource", () => {
    const args = idArg({
      singular: "user",
      idField: "id",
      idOf: (written) => written.id,
      columns: [],
    });
    expect(args!.id!.required).toBe(true);
    expect(args!.id!.description).toBe("user id");
  });
});

describe("article", () => {
  it.each([
    ["identity provider connection", "an"],
    ["event", "an"],
    ["team", "a"],
    // Spelled with a vowel, said with a "yoo".
    ["user", "a"],
    ["unique id", "a"],
  ])('%s takes "%s"', (phrase, expected) => {
    expect(article(phrase)).toBe(expected);
  });
});

describe("capitalize", () => {
  it("upper-cases the first character only", () => {
    expect(capitalize("revoke")).toBe("Revoke");
    expect(capitalize("")).toBe("");
  });
});

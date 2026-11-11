import { describe, expect, it } from "vitest";
import { z } from "zod";

import { unscopedCommand } from "@/lib/suggestion";
import { article, capitalize, dryRunResult, idArg, parseOrThrow } from "@/lib/oclif/crud/shared";

const REAL = unscopedCommand("users delete user_1");

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
    const result = dryRunResult({
      verb: "create",
      topic: "users",
      body: { schema: "s" },
      next: REAL,
    });
    expect(result).toMatchObject({
      status: "ok",
      data: { dry_run: true, verb: "create", topic: "users", body: { schema: "s" } },
    });
    expect(result.pretty?.text).toBe('Would create users (dry run)\n{\n  "schema": "s"\n}');
  });

  it("reports what the server answered when it was asked", () => {
    const result = dryRunResult({
      next: REAL,
      verb: "update",
      topic: "users",
      id: "user_1",
      body: { schema: "s" },
      checked: { id: "user_1", schema: "s" },
    });
    expect(result.data).toMatchObject({ result: { id: "user_1", schema: "s" } });
    expect(result.pretty?.text).toBe(
      'Would update users user_1 (dry run)\n{\n  "schema": "s"\n}\nThe server would accept this. Nothing changed.',
    );
  });

  it("masks a credential in the server's answer as it does in the body", () => {
    const result = dryRunResult({
      next: REAL,
      verb: "update",
      topic: "users",
      id: "user_1",
      checked: { attributes: { password: "hunter2" } },
    });
    expect(JSON.stringify(result.data)).not.toContain("hunter2");
  });

  it("leaves the answer out when the server was not asked", () => {
    expect(dryRunResult({ verb: "create", topic: "users", next: REAL }).data).not.toHaveProperty(
      "result",
    );
  });

  it("describes a delete by id without a body", () => {
    expect(
      dryRunResult({ verb: "revoke", topic: "sessions", id: "sess_1", next: REAL }).pretty?.text,
    ).toBe("Would revoke sessions sess_1 (dry run)");
  });

  it("spells the body the way JSON does, so the block a reader copies parses", () => {
    const result = dryRunResult({
      next: REAL,
      verb: "create",
      topic: "users",
      body: { attributes: { nickname: "a\u009bb" } },
    });

    const document = result.pretty?.text.slice(result.pretty.text.indexOf("\n") + 1) ?? "";
    expect(document).not.toContain("\u009b");
    expect(JSON.parse(document)).toEqual({ attributes: { nickname: "a\u009bb" } });
  });
});

describe("dryRunResult next step", () => {
  it("offers the real command as the one next command", () => {
    const result = dryRunResult({ verb: "delete", topic: "users", id: "user_1", next: REAL });

    expect(result).toMatchObject({ next: { commands: [REAL] } });
  });
});

describe("dryRunResult summary", () => {
  it("titles the summary with what would happen", () => {
    expect(dryRunResult({ verb: "create", topic: "users", next: REAL }).summary?.title).toBe(
      "Would create users (dry run)",
    );
  });

  it("gives the envelope the title the terminal draws", () => {
    const result = dryRunResult({ verb: "create", topic: "users", next: REAL });

    expect(result).toMatchObject({ data: { title: "Would create users (dry run)" } });
  });

  it("names the resource by its noun in the title and keeps the topic in the data", () => {
    const result = dryRunResult({
      next: REAL,
      verb: "delete",
      topic: "idps",
      noun: "identity provider",
      id: "i1",
    });

    expect(result).toMatchObject({
      data: { topic: "idps", title: "Would delete identity provider i1 (dry run)" },
    });
  });

  it("draws the title as one line when the id has a line break in it", () => {
    const title = dryRunResult({ verb: "remove", topic: "origin", id: "a\nb", next: REAL }).summary
      ?.title;

    expect(title).toBe("Would remove origin a\\x0ab (dry run)");
  });

  it("spells out an escape byte in the title", () => {
    const title = dryRunResult({ verb: "create", topic: "users\u001b[2J", next: REAL }).summary
      ?.title;

    expect(title).toBe("Would create users\\x1b[2J (dry run)");
    expect(title).not.toContain("\u001b");
  });
});

describe("dryRunResult redaction", () => {
  it("masks a credential that reached the body legitimately, from a file", () => {
    const result = dryRunResult({
      next: REAL,
      verb: "create",
      topic: "users",
      body: {
        schema: "sch_1",
        attributes: { email: "a@b.c", password: "hunter2", tags: [{ token: "t" }] },
      },
    });
    expect(result.data).toEqual({
      dry_run: true,
      title: "Would create users (dry run)",
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

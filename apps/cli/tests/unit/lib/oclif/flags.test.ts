import { Args, Flags } from "@oclif/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { filled, reads, serverFlag, taken, whole } from "@/lib/oclif/flags";
import { parseArg, parseFlag } from "@tests/helpers/inputs";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

/**
 * `required: true` asks only whether a token reached argv, and an empty one
 * satisfies it — `--flag "$VAR"` with `VAR` unset sends exactly that. These
 * pin the refusal that oclif's own `required` does not perform.
 */
describe("a flag that must not be blank", () => {
  it("refuses an empty value, where oclif's own check passes it", async () => {
    const result = await runCliForTest([
      "auth-method",
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "",
      "--json",
    ]);

    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result.stdout) as { code: string; hint?: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.hint).toContain("--client-id");
  });

  it("refuses a value that is only whitespace", async () => {
    const result = await runCliForTest([
      "auth-method",
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "   ",
      "--json",
    ]);

    expect((parseJson(result.stdout) as { code: string }).code).toBe("E_VALIDATION");
  });

  it("still refuses a missing value the way oclif always did", async () => {
    // Unquoted `--client-id $UNSET` drops the word entirely; that path was
    // never broken and must keep its own wording.
    const result = await runCliForTest([
      "auth-method",
      "sso",
      "enable",
      "--provider",
      "google",
      "--client-id",
      "--json",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect((parseJson(result.stdout) as { message: string }).message).toContain("expects a value");
  });
});

describe("an argument that must not be blank", () => {
  it("refuses an empty name before the command runs", async () => {
    const result = await runCliForTest(["variable", "get", "", "--json"]);

    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("empty value");
  });

  it("leaves a real name alone, trimmed", async () => {
    // A padded value parses and is trimmed, so the run gets past the blank
    // check and fails later for want of a resolved server, not for the name.
    const result = await runCliForTest(["variable", "get", "  FOO  ", "--json"]);

    const json = parseJson(result.stdout) as { message: string };
    expect(json.message).not.toMatch(/empty value|Invalid variable name/);
  });
});

describe("the schemas a flag is built from", () => {
  describe("filled", () => {
    it("keeps a value, trimmed", () => {
      expect(filled.parse("  FOO  ")).toBe("FOO");
    });

    it.each(["", "   "])("refuses %j, which holds nothing", (value) => {
      expect(filled.safeParse(value).success).toBe(false);
    });
  });

  describe("whole", () => {
    it.each([
      ["8080", 8080],
      ["  80  ", 80],
      ["-1", -1],
      ["0", 0],
    ])("reads %j as %d", (value, expected) => {
      expect(whole.parse(value)).toBe(expected);
    });

    it.each([
      ["80.5", "is not whole"],
      ["http", "is not a number"],
      ["", "holds nothing"],
      ["1e3", "is not how a count is typed"],
      ["9".repeat(309), "overflows to Infinity"],
      ["9007199254740993", "rounds past what Number holds exactly"],
    ])("refuses %j, which %s", (value) => {
      expect(whole.safeParse(value).success).toBe(false);
    });
  });
});

describe("a flag built with reads", () => {
  const portFlag = Flags.custom<number>({
    parse: reads({
      schema: whole.pipe(z.number().min(1).max(65_535)),
      refusal: {
        message: "{value} is not a TCP port",
        hint: "Use a TCP port from 1 to 65535.",
      },
    }),
  });

  it("hands the command the parsed value, not the text", async () => {
    await expect(parseFlag(portFlag({}), "8080", "port")).resolves.toBe(8080);
  });

  it.each(["0", "65536", "80.5", "1e3", ""])("refuses %j in its own words", async (value) => {
    await expect(parseFlag(portFlag({}), value, "port")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: `${value} is not a TCP port`,
      hint: "Use a TCP port from 1 to 65535.",
    });
  });

  it("names the flag the value was given for", async () => {
    const named = Flags.custom<string>({
      parse: reads({
        schema: filled,
        refusal: {
          message: "{input} was given an empty value",
        },
      }),
    });

    await expect(parseFlag(named({}), "", "client-id")).rejects.toMatchObject({
      message: "--client-id was given an empty value",
    });
  });

  it("words a refusal with what the schema found wrong", async () => {
    const level = Flags.custom<number>({
      parse: reads({
        schema: whole.pipe(z.number().max(5, "there is no level above 5")),
        refusal: {
          message: "{value} is not a level: {problem}",
        },
      }),
    });

    await expect(parseFlag(level({}), "9", "level")).rejects.toMatchObject({
      message: "9 is not a level: there is no level above 5",
    });
  });
});

describe("a refusal a flag or argument is built with", () => {
  const LIMITED = {
    schema: z.string(),
    refusal: { message: "{input} takes at most {max} characters" },
  } as const;
  const LIMITED_FILLED = { ...LIMITED, values: { max: 3 } } as const;

  it("does not compile without a value only its declaration can fill", () => {
    // @ts-expect-error nothing fills {max}
    reads(LIMITED);
    // @ts-expect-error nothing fills {max}
    taken(LIMITED);

    expect(reads({ ...LIMITED, values: { max: 3 } })).toBeTypeOf("function");
  });

  it("does not compile without that value when the declaration is written inline", () => {
    // @ts-expect-error nothing fills {max}
    reads({ schema: z.string(), refusal: { message: "{input} takes at most {max} characters" } });
    // @ts-expect-error nothing fills {max}
    taken({ schema: z.string(), refusal: { message: "{input} takes at most {max} characters" } });

    expect(
      taken({
        schema: z.string(),
        refusal: { message: "{input} takes at most {max} characters" },
        values: { max: 3 },
      }),
    ).toBeTypeOf("function");
  });

  it("does not compile with a type argument that would leave the wording unread", () => {
    // @ts-expect-error the declaration is always inferred, so its wording is read
    reads<string>(LIMITED);

    expect(reads(LIMITED_FILLED)).toBeTypeOf("function");
  });

  it("does not compile with a next entry the parse has nothing to fill", () => {
    // @ts-expect-error a flag's refusal has no next values to fill {fix} with
    reads({ schema: z.string(), refusal: { message: "{input} is wrong", next: ["{fix}"] } });

    expect(
      reads({
        schema: z.string(),
        refusal: { message: "{input} is wrong", next: [{ id: "start" }] },
      }),
    ).toBeTypeOf("function");
  });
});

describe("an argument built with taken", () => {
  const nameArg = Args.custom<string>({
    parse: taken({
      schema: filled,
      refusal: {
        message: "{input} was given an empty value",
      },
    }),
  });

  it("names the argument as the help does, without a dash", async () => {
    await expect(parseArg(nameArg({}), "", "release_id")).rejects.toMatchObject({
      message: "release_id was given an empty value",
    });
  });
});

describe("the server flag", () => {
  it.each(["local", "https://acme.zitadel.cloud", "http://localhost:8080"])(
    "takes %j as typed",
    async (value) => {
      await expect(parseFlag(serverFlag({}), value, "server")).resolves.toBe(value);
    },
  );

  it.each(["ftp://acme.example", "acme.example", ""])("refuses %j", async (value) => {
    await expect(parseFlag(serverFlag({}), value, "server")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: `Invalid server "${value}"`,
    });
  });
});

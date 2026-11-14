import { Args, Flags } from "@oclif/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import {
  accepts,
  filled,
  parses,
  type ReadAlone,
  reads,
  serverFlag,
  taken,
  whole,
} from "@/lib/oclif/flags";
import type { Placeholders } from "@/lib/oclif/refusal";
import { parseArg, parseFlag } from "@tests/helpers/inputs";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

/** A refusal's wording that asks for a bound only its declaration can give. */
const LIMITED_WORDING = "{input} takes at most {max} characters";

/** A refusal's wording that asks for nothing the parse does not fill. */
const WRONG_WORDING = "{input} is wrong";

/** A hint for {@link WRONG_WORDING}. */
const HINT = "Pass another one.";

/** Which of two refusals a declaration picks, known only when it runs. */
const CHOOSE: boolean = HINT.length > 0;

/** One of two wordings a condition picks between, asking for `{a}`. */
const NEEDS_A = "{input} needs {a}";

/** The other, asking for `{b}`. */
const NEEDS_B = "{input} needs {b}";

/** Values typed as wide as `Placeholders`, which name nothing for certain. */
const WIDE_VALUES: Placeholders = { max: 3 };

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
  const LIMITED = { schema: z.string(), refusal: { message: LIMITED_WORDING } } as const;
  const LIMITED_FILLED = { ...LIMITED, values: { max: 3 } } as const;
  const OPTIONAL_MAX: { readonly max?: number } = {};

  it("does not compile in reads without a value only its declaration can fill", () => {
    // @ts-expect-error nothing fills {max}
    reads(LIMITED);
  });

  it("does not compile in taken without a value only its declaration can fill", () => {
    // @ts-expect-error nothing fills {max}
    taken(LIMITED);
  });

  it("compiles with the value its declaration gives", () => {
    expect(reads(LIMITED_FILLED)).toBeTypeOf("function");
  });

  it("does not compile in reads without that value when the declaration is written inline", () => {
    // @ts-expect-error nothing fills {max}
    reads({ schema: z.string(), refusal: { message: LIMITED_WORDING } });
  });

  it("does not compile in taken without that value when the declaration is written inline", () => {
    // @ts-expect-error nothing fills {max}
    taken({ schema: z.string(), refusal: { message: LIMITED_WORDING } });
  });

  it("compiles with that value written inline", () => {
    expect(
      taken({ schema: z.string(), refusal: { message: LIMITED_WORDING }, values: { max: 3 } }),
    ).toBeTypeOf("function");
  });

  it("does not compile with a value that is undefined", () => {
    // @ts-expect-error an undefined {max} leaves the braces in the wording
    reads({ ...LIMITED, values: { max: undefined } });
  });

  it("does not compile with a value that is optional", () => {
    // @ts-expect-error an optional {max} may leave the braces in the wording
    reads({ ...LIMITED, values: OPTIONAL_MAX });
  });

  it("does not compile with a value the parse would replace", () => {
    // @ts-expect-error the parse fills {value} with what was typed
    reads({ schema: z.string(), refusal: { message: WRONG_WORDING }, values: { value: 3 } });
  });

  it("does not compile with a value the parse would replace, even as undefined", () => {
    reads({
      schema: z.string(),
      refusal: { message: WRONG_WORDING },
      // @ts-expect-error not even as undefined, which would read as a value given
      values: { input: undefined },
    });
  });

  it("does not compile with values whose names it cannot see", () => {
    // @ts-expect-error values as wide as Placeholders may hide a name the parse replaces
    reads({ schema: z.string(), refusal: { message: WRONG_WORDING }, values: WIDE_VALUES });
  });

  it("does not compile with a key a refusal does not have", () => {
    // @ts-expect-error a refusal has no hnt, so the hint would be lost
    reads({ schema: z.string(), refusal: { message: WRONG_WORDING, hnt: HINT } });
  });

  it("does not compile with a key a declaration does not have", () => {
    // @ts-expect-error a declaration has no vaules, so the values would be lost
    reads({ schema: z.string(), refusal: { message: WRONG_WORDING }, vaules: { max: 3 } });
  });

  it("does not compile without what either of two refusals chosen by a condition asks for", () => {
    reads({
      schema: z.string(),
      refusal: CHOOSE ? { message: NEEDS_A } : { message: NEEDS_B },
      // @ts-expect-error the second refusal asks for {b}
      values: { a: 1 },
    });
  });

  it("compiles with what both of two refusals chosen by a condition ask for", () => {
    expect(
      reads({
        schema: z.string(),
        refusal: CHOOSE ? { message: NEEDS_A } : { message: NEEDS_B },
        values: { a: 1, b: 2 },
      }),
    ).toBeTypeOf("function");
  });

  it("does not compile with a next entry the parse has nothing to fill", () => {
    // @ts-expect-error a flag's refusal has no next values to fill {fix} with
    reads({ schema: z.string(), refusal: { message: WRONG_WORDING, next: ["{fix}"] } });
  });

  it("compiles with a next entry that is a whole suggestion", () => {
    expect(
      reads({ schema: z.string(), refusal: { message: WRONG_WORDING, next: [{ id: "start" }] } }),
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

/**
 * A parser that accepts digits and answers with their number.
 *
 * @param value - The text.
 * @returns The number, or what is wrong with the text.
 */
function digits(value: string): { ok: true; value: number } | { ok: false; problem: string } {
  return /^\d+$/.test(value)
    ? { ok: true, value: Number(value) }
    : { ok: false, problem: "Use digits only." };
}

describe("a flag that is its parser", () => {
  const count = Flags.custom<number>({ parse: parses(digits) });
  const text = Flags.custom<string>({ parse: accepts(digits) });

  it("yields what the parser made of the trimmed text", async () => {
    await expect(parseFlag(count({}), " 42 ", "count")).resolves.toBe(42);
  });

  it("keeps the trimmed text when the parser only checks it", async () => {
    await expect(parseFlag(text({}), " 42 ", "count")).resolves.toBe("42");
  });

  it("refuses what the parser refuses, with its reason, naming the flag", async () => {
    await expect(parseFlag(count({}), "x", "count")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "--count: Use digits only.",
      hint: "Fix --count and run the command again.",
      details: { flag: "--count" },
    });
  });

  it("refuses a blank value apart, saying to pass one", async () => {
    await expect(parseFlag(count({}), "  ", "count")).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "the value is empty",
      hint: "Pass a value for --count, or omit it entirely.",
    });
  });

  it("words a blank value as the flag's own refusal when told to", async () => {
    const asked = Flags.custom<number>({ parse: parses(digits, { blankAsValue: true }) });

    await expect(parseFlag(asked({}), "  ", "count")).rejects.toMatchObject({
      message: "--count: it was given an empty value",
    });
  });

  it("uses the wording it is given", async () => {
    const worded = Flags.custom<number>({
      parse: parses(digits, {
        refusal: { message: "{input} is {problem}", hint: "Try again." },
        empty: { message: "{input} is blank", hint: "Pass one." },
      }),
    });

    await expect(parseFlag(worded({}), "x", "count")).rejects.toMatchObject({
      message: "--count is Use digits only.",
    });
    await expect(parseFlag(worded({}), "", "count")).rejects.toMatchObject({
      message: "--count is blank",
    });
  });
});

describe("ReadAlone", () => {
  it("asks nothing of a refusal that wants only what the parse fills", () => {
    expectTypeOf<ReadAlone<{ readonly message: "{input} is empty" }>>().toEqualTypeOf<unknown>();
  });

  it("refuses a refusal that wants what only values could fill, values beside it or not", () => {
    expectTypeOf<{
      readonly message: "{max}";
      readonly values: { readonly max: 5 };
    }>().not.toExtend<ReadAlone<{ readonly message: "{max}" }>>();
  });
});

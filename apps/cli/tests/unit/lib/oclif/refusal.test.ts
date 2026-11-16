import { describe, expect, it } from "vitest";

import { interpolate, type Refusal, refusalError, unmetBy } from "@/lib/oclif/refusal";

/**
 * A refusal with a whole `next` placeholder, typed {@link Refusal}: its
 * wording is only known as text, so the compiler asks for nothing and only the
 * run decides what fills it.
 */
const WIDE_NEXT: Refusal = { message: "No server", next: ["{next}"] };

/** The same refusal written as a literal, whose `{next}` the compiler reads. */
const LITERAL_NEXT = { message: "No server", next: ["{next}"] } as const;

/** A command line written by hand, which a `next` placeholder must never take. */
const BY_HAND = "deploy -m x";

/** A `next` string with two placeholders in it, which is no whole placeholder. */
const TWO_PLACEHOLDERS = "{a} then {b}";

/** A hint known only as text, beside a message written as a literal. */
const WIDE_HINT: string = "Try another one.";

/** A refusal whose details ask for a value, one of two a condition chooses between. */
const DETAILED = { message: "No schema", details: { known: "{known}" } } as const;

/** A refusal that asks for nothing, the other of the two. */
const PLAIN = { message: "No schemas yet" } as const;

describe("interpolate", () => {
  it("fills each placeholder from the values", () => {
    expect(interpolate("{flag} cannot be {value}", { flag: "--port", value: 0 })).toBe(
      "--port cannot be 0",
    );
  });

  it("fills a placeholder named with a hyphen", () => {
    expect(interpolate("{sso-client-id} is set", { "sso-client-id": "abc" })).toBe("abc is set");
  });

  it("fills a placeholder that appears twice", () => {
    expect(interpolate("{a}{a}", { a: "x" })).toBe("xx");
  });

  it("leaves a placeholder that has no value as it was written", () => {
    // A refusal with a placeholder nothing fills is a defect in its wording,
    // but the person is still being refused: throwing here would cost the
    // error the code that says why.
    expect(interpolate("from {min} to {max}", { min: 1 })).toBe("from 1 to {max}");
  });
});

describe("refusalError", () => {
  it("raises E_VALIDATION with the message and the hint filled in", () => {
    const error = refusalError(
      {
        message: "{value} is not a TCP port",
        hint: "Use a port from {min}.",
      },
      {
        value: "99999",
        min: 1,
      },
    );

    expect(error.code).toBe("E_VALIDATION");
    expect(error.message).toBe("99999 is not a TCP port");
    expect(error.hint).toBe("Use a port from 1.");
  });

  it("expands a next entry whose value is a list, so one entry can name both steps", () => {
    const error = refusalError(
      {
        message: "No primary origin",
        next: ["{next}"],
      },
      {},
      {
        next: [
          { id: "origin:rm", args: { pattern: "http://localhost:3000" }, flags: { force: true } },
          {
            id: "origin:add",
            args: { pattern: "http://localhost:3000" },
            flags: { kind: "primary" },
          },
        ],
      },
    );

    expect(error.nextCommands).toEqual([
      { id: "origin:rm", args: { pattern: "http://localhost:3000" }, flags: { force: true } },
      { id: "origin:add", args: { pattern: "http://localhost:3000" }, flags: { kind: "primary" } },
    ]);
  });

  it("keeps each next command a suggestion, for the run that reports it to render", () => {
    const error = refusalError(
      {
        message: "No server",
        next: [{ id: "start", flags: { port: 8080 } }],
      },
      {},
    );

    expect(error.nextCommands).toEqual([{ id: "start", flags: { port: 8080 } }]);
  });

  it("fills a next placeholder only from the next values, never from a string among the others", () => {
    const error = refusalError(WIDE_NEXT, { next: BY_HAND });

    expect(error.nextCommands).toEqual([]);
  });

  it("does not compile with a string for a next placeholder", () => {
    // @ts-expect-error a whole `next` placeholder is filled with a follow-up, never a string
    refusalError(LITERAL_NEXT, {}, { next: BY_HAND });
  });

  it("does not compile without the `next` values a placeholder asks for", () => {
    // @ts-expect-error the `next` values the placeholder asks for are left out
    refusalError(LITERAL_NEXT, {});
  });

  it("names nothing for a placeholder no value fills", () => {
    expect(refusalError(WIDE_NEXT, {}).nextCommands).toEqual([]);
  });

  it("carries no hint and no suggestions when the refusal has none", () => {
    const error = refusalError({ message: "No" }, {});

    expect(error.hint).toBeUndefined();
    expect(error.nextCommands).toBeUndefined();
  });
});

describe("refusalError's values", () => {
  const ASKS = {
    message: "No schema named {requested}",
    hint: "Known: {labels}",
    details: { known: "{known}" },
  } as const;

  it("does not compile without a value its hint asks for", () => {
    // @ts-expect-error the hint asks for {labels}
    refusalError(ASKS, { requested: "x", known: [] });
  });

  it("does not compile without a value its details ask for", () => {
    // @ts-expect-error the details ask for {known}
    refusalError(ASKS, { requested: "x", labels: "a" });
  });

  it("fills its hint with the values given", () => {
    expect(refusalError(ASKS, { requested: "x", labels: "a", known: [] }).hint).toBe("Known: a");
  });

  it("does not compile without the follow-up a whole next placeholder asks for", () => {
    // @ts-expect-error the `next` values must give {fix}
    refusalError({ message: "No", next: ["{fix}"] }, {});
  });

  it("fills a whole next placeholder with the follow-up given", () => {
    expect(
      refusalError({ message: "No", next: ["{fix}"] }, {}, { fix: { id: "start" } }).nextCommands,
    ).toEqual([{ id: "start" }]);
  });

  it("takes any values for a refusal whose wording is only known as text", () => {
    const wide: Refusal = { message: "No {thing}" };

    expect(refusalError(wide, {}).message).toBe("No {thing}");
  });

  it("still asks for what a literal message names when the hint is only known as text", () => {
    // @ts-expect-error the message asks for {thing}
    refusalError({ message: "No {thing}", hint: WIDE_HINT } as const, {});
  });

  it("fills a literal message beside a hint only known as text", () => {
    const named = { message: "No {thing}", hint: WIDE_HINT } as const;

    expect(refusalError(named, { thing: "schema" }).message).toBe("No schema");
  });

  it("asks for what either of two refusals chosen by a condition asks for", () => {
    // @ts-expect-error the detailed refusal's details ask for {known}
    refusalError(WIDE_HINT.length > 0 ? DETAILED : PLAIN, {});
  });

  it("raises the refusal a condition chose", () => {
    const chosen = WIDE_HINT.length > 0 ? DETAILED : PLAIN;

    expect(refusalError(chosen, { known: "a" }).message).toBe("No schema");
  });

  it("asks for a name inside doubled braces, as the run fills it", () => {
    // @ts-expect-error the message asks for {limit}
    refusalError({ message: "{{limit}} reached" } as const, {});
  });

  it("fills a name inside doubled braces, keeping the outer pair", () => {
    expect(refusalError({ message: "{{limit}} reached" } as const, { limit: 3 }).message).toBe(
      "{3} reached",
    );
  });

  it("asks for the name after a brace that never closes, as the run fills it", () => {
    // @ts-expect-error the message asks for {other}
    refusalError({ message: "Use {one {other}" } as const, {});
  });

  it("fills the name after a brace that never closes", () => {
    expect(refusalError({ message: "Use {one {other}" } as const, { other: "x" }).message).toBe(
      "Use {one x",
    );
  });

  it("asks for nothing a pair of braces holds that is not a name", () => {
    const braces = { message: "Pass {} or {a.b} or {json|yaml}" } as const;

    expect(refusalError(braces, {}).message).toBe("Pass {} or {a.b} or {json|yaml}");
  });

  it("does not compile with a next string that holds text around a placeholder", () => {
    refusalError(
      {
        message: "No",
        // @ts-expect-error a next string is a whole placeholder or nothing
        next: ["run {help}"],
      },
      {},
    );
  });

  it("does not compile with a next string that is not one placeholder", () => {
    refusalError(
      {
        message: "No",
        // @ts-expect-error the run fills only a next string that is one {name}
        next: [TWO_PLACEHOLDERS],
      },
      {},
    );
  });

  it("names nothing for a next string that is not one placeholder", () => {
    const wide: Refusal = { message: "No", next: [TWO_PLACEHOLDERS] };

    expect(refusalError(wide, {}).nextCommands).toEqual([]);
  });
});

describe("refusalError with a code and details", () => {
  it("raises the code it names, carrying its details", () => {
    const error = refusalError(
      {
        code: "E_NOT_FOUND",
        message: "No {name}",
        details: {
          file: "schema.json",
        },
      },
      {
        name: "flow",
      },
    );

    expect(error.code).toBe("E_NOT_FOUND");
    expect(error.message).toBe("No flow");
    expect(error.details).toEqual({ file: "schema.json" });
  });
});

describe("refusalError raised where no run exists", () => {
  it("raises a refusal that names no next command", () => {
    expect(refusalError({ message: "No" }, {}).message).toBe("No");
  });

  it("keeps its next command for the run that reports it", () => {
    const error = refusalError({ code: "E_CONFLICT", message: "No", next: [{ id: "start" }] }, {});

    expect(error.code).toBe("E_CONFLICT");
    expect(error.nextCommands).toEqual([{ id: "start" }]);
  });
});

describe("refusalError details", () => {
  it("keeps a list a list when a detail is only a placeholder", () => {
    const error = refusalError(
      {
        message: "No {noun}",
        details: {
          missing: "{names}",
          note: "see {noun}",
        },
      },
      {
        noun: "column",
        names: ["a", "b"],
      },
    );

    expect(error.details).toEqual({
      missing: ["a", "b"],
      note: "see column",
    });
  });
});

describe("refusalError's details", () => {
  it("keeps a value that is not plain data as it is", () => {
    const at = new Date("2026-01-01T00:00:00.000Z");

    const error = refusalError({ message: "No", details: { at } }, {});

    expect(error.details).toEqual({ at });
  });
});

describe("unmetBy", () => {
  it("names a placeholder in the details that nothing fills", () => {
    const refusal: Refusal = { message: "No schema", details: { known: ["{known}"] } };

    expect(unmetBy(refusal, {})).toEqual(["known"]);
  });

  it("names a next string that is not one placeholder, which nothing can fill", () => {
    const refusal: Refusal = { message: "No", next: [TWO_PLACEHOLDERS] };

    expect(unmetBy(refusal, {}, {})).toEqual([TWO_PLACEHOLDERS]);
  });

  it("names what a refusal's wording would leave unfilled", () => {
    const refusal = {
      message: "{value} is not a valid page size",
      hint: "Use a whole number from {min} to {max}.",
    };

    expect(unmetBy(refusal, { value: "0", min: 1 })).toEqual(["max"]);
  });

  it("is empty for a refusal every placeholder of which is filled", () => {
    const refusal = {
      message: "{value} is not a TCP port",
      hint: "Use a TCP port from {min} to {max}.",
      next: ["{retry}" as const],
    };

    expect(
      unmetBy(refusal, { value: "0", min: 1, max: 65_535 }, { retry: { id: "start" } }),
    ).toEqual([]);
  });

  it("counts a next placeholder the next values leave unfilled, whatever the other values hold", () => {
    const refusal = { message: "No server", next: ["{retry}" as const] };

    expect(unmetBy(refusal, { retry: "start" })).toEqual(["retry"]);
  });
});

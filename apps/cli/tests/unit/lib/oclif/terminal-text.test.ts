import { describe, expect, it } from "vitest";

import {
  escapeControlCharacters,
  escapeControlCharactersDeep,
} from "../../../../src/lib/oclif/terminal-text";

describe("escapeControlCharacters", () => {
  it("escapes C0, DEL, C1, format and separator characters", () => {
    expect(escapeControlCharacters("a\u0000\u001b\u007f\u009b\u200e\u202e\u2028\u2029b")).toBe(
      "a\\x00\\x1b\\x7f\\x9b\\u200e\\u202e\\u2028\\u2029b",
    );
  });

  it("spells a format character above the BMP so it cannot run into the next one", () => {
    expect(escapeControlCharacters("a\u{e0001}7")).toBe("a\\u{e0001}7");
  });

  it("keeps newline and tab unless asked to escape them", () => {
    expect(escapeControlCharacters("one\ntwo\tthree")).toBe("one\ntwo\tthree");
    expect(escapeControlCharacters("one\ntwo\tthree", { keepLayout: false })).toBe(
      "one\\x0atwo\\x09three",
    );
  });

  it("leaves ordinary text, including non-ASCII, alone", () => {
    expect(escapeControlCharacters("Zoë 日本 🚀")).toBe("Zoë 日本 🚀");
  });
});

describe("escapeControlCharactersDeep", () => {
  it("escapes a hostile string at any depth", () => {
    expect(
      escapeControlCharactersDeep({
        name: "\u001b[2Jwiped",
        nested: {
          tags: ["ok", "\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007"],
          "key\u001b": [
            {
              deep: "\u009b31m",
            },
          ],
        },
      }),
    ).toEqual({
      name: "\\x1b[2Jwiped",
      nested: {
        tags: ["ok", "\\x1b]8;;https://evil.example\\x07click\\x1b]8;;\\x07"],
        "key\\x1b": [
          {
            deep: "\\x9b31m",
          },
        ],
      },
    });
  });

  it("keeps two keys apart when one spells out the other's escape", () => {
    expect(
      escapeControlCharactersDeep({
        "k\u001b": 1,
        "k\\x1b": 2,
        "a\\b": 3,
      }),
    ).toEqual({
      "k\\x1b": 1,
      "k\\\\x1b": 2,
      "a\\\\b": 3,
    });
  });

  it("walks a value nested deeper than the call stack", () => {
    const depth = 20_000;
    // Parsed from text: `JSON.stringify` itself cannot serialise this depth.
    const value: unknown = JSON.parse(`${"[".repeat(depth)}"\\u001b"${"]".repeat(depth)}`);

    const node = Array.from({ length: depth }).reduce<unknown>((inner) => {
      return (inner as unknown[])[0];
    }, escapeControlCharactersDeep(value));

    expect(node).toBe("\\x1b");
  });

  it("keeps a __proto__ key as a field", () => {
    const escaped = escapeControlCharactersDeep(
      JSON.parse('{"__proto__": {"polluted": "\\u001b"}}'),
    ) as Record<string, unknown>;

    expect(Object.getOwnPropertyNames(escaped)).toEqual(["__proto__"]);
    expect(Object.getPrototypeOf(escaped)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("keeps newlines and tabs and leaves non-strings untouched", () => {
    expect(
      escapeControlCharactersDeep({
        description: "line one\n\tline two",
        count: 3,
        active: true,
        gone: null,
      }),
    ).toEqual({
      description: "line one\n\tline two",
      count: 3,
      active: true,
      gone: null,
    });
  });
});

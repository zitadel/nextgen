import { describe, expect, it } from "vitest";

import { CONFIG_DIRECTORIES, UnparsedFile } from "@/lib/zitadel";

/**
 * A file's path, which the reasons it is refused do not depend on.
 */
const PATH = `${CONFIG_DIRECTORIES.connections}/a.json`;

/**
 * A secret pasted into a file by mistake, short enough that V8 would quote all
 * of it (it quotes at most 10 characters of the token it choked on).
 */
const PASTED = "pasted_v";

/**
 * Lists opened and never closed, then a word, far more than a parser can
 * follow down.
 */
const DEEPLY_NESTED = `${"[".repeat(50_000)}${PASTED}`;

describe("UnparsedFile.invalidJson", () => {
  describe("when V8 places the error", () => {
    it.each([
      { name: "an object that is never closed", text: '{"a": 1', expected: "line 1, column 8" },
      { name: "a list that is never closed", text: "[1, 2", expected: "line 1, column 6" },
      { name: "a string that is never closed", text: '{"a": "x', expected: "line 1, column 9" },
      { name: "a missing property name", text: "{ not json", expected: "line 1, column 3" },
      { name: "a trailing comma", text: '{"a": 1,}', expected: "line 1, column 9" },
      { name: "a missing colon", text: '{"a" 1}', expected: "line 1, column 6" },
      { name: "a missing comma", text: '{"a": 1 "b": 2}', expected: "line 1, column 9" },
      { name: "a mismatched close", text: '{"a": [1}', expected: "line 1, column 9" },
      { name: "text after the value", text: '{"a": 1} x', expected: "line 1, column 10" },
      { name: "a comment", text: '{\n  "a": 1, // note\n}', expected: "line 2, column 11" },
      { name: "single quotes", text: "{'a': 1}", expected: "line 1, column 2" },
      { name: "a leading zero", text: "[01]", expected: "line 1, column 3" },
      { name: "a minus with no digit", text: "[-]", expected: "line 1, column 3" },
      { name: "a fraction with no digit", text: "[1.]", expected: "line 1, column 4" },
      { name: "an exponent with no digit", text: "[1e]", expected: "line 1, column 4" },
      { name: "a raw newline in a string", text: '{"a": "x\ny"}', expected: "line 1, column 9" },
      { name: "a bad escape", text: '{"a": "\\R"}', expected: "line 1, column 9" },
      { name: "a short unicode escape", text: '{"a": "\\u12G4"}', expected: "line 1, column 12" },
      {
        name: "a bad escape on a later line, at the character that is wrong",
        text: '{\n  "colors": {},\n  "fonts": {\n    "body": {\n      "font_family": "\\Redaction\\", serif"\n    }\n  }\n}',
        expected: "line 5, column 24",
      },
      {
        name: "a bad escape after a carriage return alone",
        text: '{\r  "a": "\\x"\r}',
        expected: "line 2, column 10",
      },
      {
        name: "a bad escape after a carriage return and a line feed",
        text: '{\r\n  "a": 1,\r\n  "b": "\\x"\r\n}',
        expected: "line 3, column 10",
      },
    ])("places $name at $expected", ({ text, expected }) => {
      const file = UnparsedFile.invalidJson(PATH, text);

      expect(file.unparsed).toBe(`invalid JSON at ${expected}`);
    });
  });

  describe("when V8 quotes the text instead of placing the error", () => {
    it.each([
      { name: "an empty text", text: "", expected: "line 1, column 1" },
      { name: "a trailing comma in a list", text: "[1,]", expected: "line 1, column 4" },
      { name: "a byte order mark", text: '\uFEFF{"a": 1}', expected: "line 1, column 1" },
      { name: "a bare word", text: `{"a": ${PASTED}}`, expected: "line 1, column 7" },
      { name: "a misspelt literal", text: '{"a": nul}', expected: "line 1, column 7" },
      {
        name: "a bare word after a carriage return alone",
        text: `{\r  "a": ${PASTED}\r}`,
        expected: "line 2, column 8",
      },
      {
        name: "a bare word after a carriage return and a line feed",
        text: `{\r\n  "a": 1,\r\n  "b": ${PASTED}\r\n}`,
        expected: "line 3, column 8",
      },
    ])("places $name at the start of the token, $expected", ({ text, expected }) => {
      const file = UnparsedFile.invalidJson(PATH, text);

      expect(file.unparsed).toBe(`invalid JSON at ${expected}`);
    });

    it("gives no place for a text nested too deeply to follow", () => {
      const file = UnparsedFile.invalidJson(PATH, DEEPLY_NESTED);

      expect(file.unparsed).toBe("invalid JSON");
    });
  });

  it("keeps the text out of the reason", () => {
    const file = UnparsedFile.invalidJson(PATH, `{"secret": ${PASTED}}`);

    expect(file.unparsed).not.toContain(PASTED);
  });

  it("names the path it is given", () => {
    const file = UnparsedFile.invalidJson(PATH, "{");

    expect(file.path).toBe(PATH);
  });
});

describe("UnparsedFile.notAnObject", () => {
  it("gives the reason and the path", () => {
    const file = UnparsedFile.notAnObject(PATH);

    expect(file).toMatchObject({ path: PATH, unparsed: "not a JSON object" });
  });
});

describe("UnparsedFile.directory", () => {
  it("gives the reason and the path", () => {
    const file = UnparsedFile.directory(PATH);

    expect(file).toMatchObject({ path: PATH, unparsed: "is a directory" });
  });
});

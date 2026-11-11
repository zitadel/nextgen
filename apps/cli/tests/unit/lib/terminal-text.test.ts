import { describe, expect, it } from "vitest";

import {
  escapeControlCharacters,
  escapeJsonControlCharacters,
  renderCount,
  renderList,
} from "@/lib/terminal-text";

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

describe("escapeJsonControlCharacters", () => {
  it.each([
    ["DEL", "\u007f", "\\u007f"],
    ["a C1 control", "\u0085", "\\u0085"],
    ["a bidi override", "\u202e", "\\u202e"],
    ["a format character", "\u200e", "\\u200e"],
    ["a line separator", "\u2028", "\\u2028"],
    ["a paragraph separator", "\u2029", "\\u2029"],
    ["a tag character", "\u{E0001}", "\\udb40\\udc01"],
    ["a tag character spelling a letter", "\u{E0041}", "\\udb40\\udc41"],
  ])("spells out %s, which JSON writes as itself", (_what, char, escaped) => {
    const written = escapeJsonControlCharacters(JSON.stringify({ value: `a${char}b` }));

    // The bytes a reader prints carry the escape...
    expect(written).toContain(escaped);
    // ...and what a reader parses back is the character the server sent.
    expect((JSON.parse(written) as { value: string }).value).toBe(`a${char}b`);
  });

  it("writes a character above the BMP as the pair JSON spells it with", () => {
    // A `\u` escape carries four hex digits, so the code point cannot be
    // written as one: `1` would parse back as U+E000 and a `1`.
    const written = escapeJsonControlCharacters(JSON.stringify({ token: "a\u{E0001}b" }));

    expect(written).not.toContain("\\ue0001");
    expect((JSON.parse(written) as { token: string }).token).toBe("a\u{E0001}b");
  });

  it("leaves ordinary text alone, whatever alphabet it is in", () => {
    const written = escapeJsonControlCharacters(JSON.stringify({ value: "Müller 日本語 🎉" }));

    expect((JSON.parse(written) as { value: string }).value).toBe("Müller 日本語 🎉");
    expect(written).not.toContain("\\u");
  });

  it("leaves the colour a renderer painted the JSON with", () => {
    // C0 is the renderer's own: escaping it would print the sequence instead of
    // painting with it, and JSON has already spelled out any C0 of the server's.
    const painted = `\u001b[32m${JSON.stringify({ value: "ok" })}\u001b[39m`;

    expect(escapeJsonControlCharacters(painted)).toBe(painted);
  });
});

/** A family, which is three people joined by a zero-width joiner. */
const FAMILY = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";

/** An Arabic word spelled with a zero-width non-joiner. */
const SPELLED = "\u0643\u200C\u0645";

/** Text a right-to-left override reorders, which is the trojan-source trick. */
const REORDERED = "a\u202Eb";

describe("the format characters a word is spelled with", () => {
  it("carries a joined emoji as it came, in text a person reads", () => {
    expect(escapeControlCharacters(`Team ${FAMILY}`)).toBe(`Team ${FAMILY}`);
  });

  it("carries one as it came through serialised JSON too", () => {
    expect(escapeJsonControlCharacters(JSON.stringify({ name: FAMILY }))).toBe(
      JSON.stringify({ name: FAMILY }),
    );
  });

  it("carries a word spelled with a non-joiner, in both", () => {
    expect(escapeControlCharacters(SPELLED)).toBe(SPELLED);
    expect(escapeJsonControlCharacters(JSON.stringify(SPELLED))).toBe(JSON.stringify(SPELLED));
  });

  it("still spells out an override that reorders what a reader sees", () => {
    expect(escapeControlCharacters(REORDERED)).toBe("a\\u202eb");
    expect(escapeJsonControlCharacters(JSON.stringify(REORDERED))).toContain("\\u202e");
  });

  it("still spells out a tag character, which hides text rather than spelling it", () => {
    expect(escapeControlCharacters("a\u{E0001}b")).toBe("a\\u{e0001}b");
  });
});

describe("renderCount", () => {
  it("uses the singular for one", () => {
    expect(renderCount(1, { singular: "schema" })).toBe("1 schema");
  });

  it("adds an s when the noun names no plural", () => {
    expect(renderCount(12, { singular: "resource" })).toBe("12 resources");
  });

  it("uses the noun's own plural when it has one", () => {
    expect(renderCount(2, { singular: "flow definition", plural: "flow definitions" })).toBe(
      "2 flow definitions",
    );
  });

  it("counts none in the plural", () => {
    expect(renderCount(0, { singular: "operation" })).toBe("0 operations");
  });
});

describe("renderList", () => {
  it.each([
    [["a"], "a"],
    [["a", "b"], "a and b"],
    [["a", "b", "c"], "a, b, and c"],
  ])("writes %j as %s", (items, phrase) => {
    expect(renderList(items)).toBe(phrase);
  });
});

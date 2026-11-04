import { describe, expect, it } from "vitest";

import {
  escapeControlCharacters,
  escapeJsonControlCharacters,
} from "../../../src/lib/terminal-text";

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
  ])("spells out %s, which JSON writes as itself", (_what, char, escaped) => {
    const written = escapeJsonControlCharacters(JSON.stringify({ value: `a${char}b` }));

    // The bytes a reader prints carry the escape...
    expect(written).toContain(escaped);
    // ...and what a reader parses back is the character the server sent.
    expect((JSON.parse(written) as { value: string }).value).toBe(`a${char}b`);
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

import { describe, expect, it } from "vitest";

import { escapeControlCharacters } from "../../../src/lib/terminal-text";

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

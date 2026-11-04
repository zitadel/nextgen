import consola, { type ConsolaReporter, type LogLevel } from "consola";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  escapeConsolaMessages,
  escapeControlCharacters,
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

describe("escapeConsolaMessages", () => {
  const printed: unknown[][] = [];
  const capture: ConsolaReporter = {
    log(logObj) {
      printed.push(logObj.args);
    },
  };
  const reporters = consola.options.reporters;
  const level: LogLevel = consola.level;

  beforeEach(() => {
    printed.length = 0;
    consola.setReporters([capture]);
    consola.level = 3;
    escapeConsolaMessages();
  });

  afterEach(() => {
    consola.setReporters([...reporters]);
    consola.level = level;
  });

  it("escapes what a step narrates, however the step printed it", () => {
    consola.success("Created project \u001b[2Jproj_1");
    consola.info("\u001b]8;;https://evil.example\u0007click\u001b]8;;\u0007");

    expect(printed).toEqual([
      ["Created project \\x1b[2Jproj_1"],
      ["\\x1b]8;;https://evil.example\\x07click\\x1b]8;;\\x07"],
    ]);
  });

  it("escapes every string of a message, and leaves anything else to be inspected", () => {
    consola.info("one \u001b", 3, {
      nested: "\u001b",
    });

    expect(printed).toEqual([
      [
        "one \\x1b",
        3,
        {
          nested: "\u001b",
        },
      ],
    ]);
  });

  it("wraps a reporter once, however often it is installed", () => {
    escapeConsolaMessages();
    escapeConsolaMessages();

    consola.info("\u001b");

    expect(printed).toEqual([["\\x1b"]]);
  });
});

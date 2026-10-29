import consola from "consola";
import { afterEach, describe, expect, it, vi } from "vitest";

import { command, printBox, renderBox, renderBoxActions, wrapForBox } from "../../../src/lib/box";
import { stripAnsi } from "../../helpers/run-cli";

describe("wrapForBox", () => {
  it("wraps prose so no line exceeds the terminal minus the frame", () => {
    const wrapped = wrapForBox("word ".repeat(30).trim(), 40);
    for (const line of wrapped.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
    expect(wrapped.split("\n").length).toBeGreaterThan(1);
  });

  it("never splits a token, so URLs survive the journey e2e scrape", () => {
    const url =
      "https://nextgen.zitadel.cloud/ui/console/claim?challenge_id=ch_abcdefghijklmnop&project_id=proj_0123456789";
    const wrapped = wrapForBox(`${url}\n\nSign in there to attach this project.`, 40);
    expect(wrapped).toContain(url);
  });

  it("measures styled text by its visible width", () => {
    const plain = "alpha beta gamma delta epsilon zeta eta theta iota";
    const styled = plain
      .split(" ")
      .map((word) => `\u001B[36m${word}\u001B[39m`)
      .join(" ");
    expect(stripAnsi(wrapForBox(styled, 40))).toBe(wrapForBox(plain, 40));
  });

  it("keeps hard line breaks and command indentation", () => {
    const message = "Install dependencies:\n\n  npm install";
    expect(wrapForBox(message, 60)).toBe(message);
  });

  it("clamps to a readable floor on absurdly narrow terminals", () => {
    const wrapped = wrapForBox("word ".repeat(10).trim(), 5);
    expect(Math.max(...wrapped.split("\n").map((line) => line.length))).toBeLessThanOrEqual(20);
  });

  it("falls back to 80 columns when the stream has no width (not a TTY)", () => {
    const line = "word ".repeat(20).trim();
    expect(wrapForBox(line, undefined)).toBe(wrapForBox(line, 80));
  });
});

describe("renderBoxActions", () => {
  it("puts each command on its own indented styled line", () => {
    const out = renderBoxActions([
      { text: "Install dependencies:", command: "npm install" },
      { text: "Verify auth in the browser." },
    ]);
    expect(out).toBe(
      `Install dependencies:\n\n  ${command("npm install")}\n\nVerify auth in the browser.`,
    );
  });
});

describe("renderBox", () => {
  it("frames the message in a rounded box under its title", () => {
    const framed = stripAnsi(renderBox({ title: "Plan summary", message: "one\ntwo" }));

    expect(framed).toContain("╭");
    expect(framed).toContain("╯");
    expect(framed).toContain("Plan summary");
    expect(framed).toMatch(/│\s+one\s+│/);
  });

  it("keeps a long line inside the terminal rather than breaking the frame", () => {
    const framed = stripAnsi(renderBox({ title: "T", message: "word ".repeat(60).trim() }));

    expect(Math.max(...framed.split("\n").map((line) => line.length))).toBeLessThanOrEqual(82);
  });

  it("never splits a token, so a URL inside survives", () => {
    const url = "https://nextgen.zitadel.cloud/ui/console/claim?challenge_id=ch_abcdefghijklmnop";

    expect(stripAnsi(renderBox({ title: "T", message: url }))).toContain(url);
  });

  it("styles `code` itself, so a line holding it still reaches the border", () => {
    const framed = stripAnsi(
      renderBox({ title: "T", message: "Run `zitadel deploy`.\nA plain line." }),
    );
    const lines = framed.split("\n").filter((line) => line.includes("│"));

    expect(framed).toContain("Run zitadel deploy.");
    expect(new Set(lines.map((line) => [...line].length)).size).toBe(1);
  });
});

describe("wrapForBox", () => {
  it("hangs a wrapped bullet under its text rather than back at the left margin", () => {
    const lines = wrapForBox(`  - ${"word ".repeat(30).trim()}`, 40).split("\n");

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toMatch(/^ {2}- \S/);
    for (const line of lines.slice(1)) {
      expect(line).toMatch(/^ {4}\S/);
    }
  });

  it("hangs a numbered step under its text", () => {
    const lines = wrapForBox(`  1. ${"word ".repeat(30).trim()}`, 40).split("\n");

    expect(lines[0]).toMatch(/^ {2}1\. \S/);
    expect(lines[1]).toMatch(/^ {5}\S/);
  });

  it("wraps a plain paragraph back at the left margin", () => {
    const lines = wrapForBox("word ".repeat(30).trim(), 40).split("\n");

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[1]).toMatch(/^\S/);
  });
});

describe("printBox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the framed box through consola, so it follows the log level and --json silence", () => {
    const spy = vi.spyOn(consola, "log").mockImplementation(() => undefined);

    printBox({ title: "Done", message: "all good" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe(renderBox({ title: "Done", message: "all good" }));
  });

  it("draws a rounded border around the title and message", () => {
    const spy = vi.spyOn(consola, "log").mockImplementation(() => undefined);

    printBox({ title: "Done", message: "all good" });

    const out = stripAnsi(String(spy.mock.calls[0]?.[0]));
    expect(out).toContain("╭");
    expect(out).toContain("Done");
    expect(out).toContain("all good");
  });

  it("is green for a result and cyan for a hint", () => {
    const spy = vi.spyOn(consola, "log").mockImplementation(() => undefined);

    printBox({ title: "Done", message: "m" });
    printBox({ title: "Hint", message: "m", tone: "info" });

    expect(String(spy.mock.calls[0]?.[0])).toContain("\u001b[32m");
    expect(String(spy.mock.calls[1]?.[0])).toContain("\u001b[36m");
  });

  it("wraps the message to the terminal before it is drawn", () => {
    const spy = vi.spyOn(consola, "log").mockImplementation(() => undefined);

    printBox({ title: "T", message: "word ".repeat(60).trim() });

    const out = stripAnsi(String(spy.mock.calls[0]?.[0]));
    expect(Math.max(...out.split("\n").map((line) => line.length))).toBeLessThanOrEqual(80);
  });
});

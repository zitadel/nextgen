import { describe, expect, it } from "vitest";

import { command, renderBoxActions, wrapForBox } from "../../../src/lib/box";

const ESC = "\\u001B";
const stripAnsi = (s: string): string => s.replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

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

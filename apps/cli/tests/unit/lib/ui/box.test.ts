import { describe, expect, it } from "vitest";

import { Box } from "@/lib/ui/box";
import { stripAnsi } from "@tests/helpers/run-cli";

describe("Box", () => {
  it("wraps prose so no line exceeds the terminal minus the frame", () => {
    const wrapped = Box.at(40).wrap("word ".repeat(30).trim());
    for (const line of wrapped.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(32);
    }
    expect(wrapped.split("\n").length).toBeGreaterThan(1);
  });

  it("never splits a token, so URLs survive the journey e2e scrape", () => {
    const url =
      "https://preview.zitadel.com/ui/console/claim?challenge_id=ch_abcdefghijklmnop&project_id=proj_0123456789";
    const wrapped = Box.at(40).wrap(`${url}\n\nSign in there to attach this project.`);
    expect(wrapped).toContain(url);
  });

  it("measures styled text by its visible width", () => {
    const plain = "alpha beta gamma delta epsilon zeta eta theta iota";
    const styled = plain
      .split(" ")
      .map((word) => `\u001B[36m${word}\u001B[39m`)
      .join(" ");
    expect(stripAnsi(Box.at(40).wrap(styled))).toBe(Box.at(40).wrap(plain));
  });

  it("keeps hard line breaks and command indentation", () => {
    const message = "Install dependencies:\n\n  npm install";
    expect(Box.at(60).wrap(message)).toBe(message);
  });

  it("clamps to a readable floor on absurdly narrow terminals", () => {
    const wrapped = Box.at(5).wrap("word ".repeat(10).trim());
    expect(Math.max(...wrapped.split("\n").map((line) => line.length))).toBeLessThanOrEqual(20);
  });

  it("falls back to 80 columns when the stream has no width (not a TTY)", () => {
    const line = "word ".repeat(20).trim();
    expect(Box.at(undefined).wrap(line)).toBe(Box.at(80).wrap(line));
  });
});

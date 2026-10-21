import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import consola from "consola";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  command,
  printBox,
  renderBox,
  renderBoxActions,
  wrapForBox,
} from "../../../../src/lib/term/box";
import { stripAnsi } from "../../../helpers/run-cli";
import { sourceFiles } from "../../../helpers/source-files";

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
});

describe("printBox", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the box through consola, so it follows the log level", () => {
    const spy = vi.spyOn(consola, "box").mockImplementation(() => undefined);

    printBox({ title: "Done", message: "all good" });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ title: "Done", message: "all good" });
  });

  it("is green unless it is a hint", () => {
    const spy = vi.spyOn(consola, "box").mockImplementation(() => undefined);

    printBox({ title: "Done", message: "m" });

    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      style: { borderColor: "green", borderStyle: "rounded", padding: 1 },
    });
  });

  it("is cyan for a hint", () => {
    const spy = vi.spyOn(consola, "box").mockImplementation(() => undefined);

    printBox({ title: "Hint", message: "m", tone: "info" });

    expect(spy.mock.calls[0]?.[0]).toMatchObject({ style: { borderColor: "cyan" } });
  });

  it("wraps the message to the terminal before it is drawn", () => {
    const spy = vi.spyOn(consola, "box").mockImplementation(() => undefined);

    printBox({ title: "T", message: "word ".repeat(60).trim() });

    const [options] = spy.mock.calls[0] ?? [];
    const message = (options as { message: string }).message;
    expect(Math.max(...message.split("\n").map((line) => line.length))).toBeLessThanOrEqual(72);
  });
});

describe("the source tree", () => {
  // Every box looks and wraps the same way only if every box is drawn the same
  // way, so lib/term/box.ts is the one place that calls consola's box.
  it("draws boxes in lib/term/box.ts only", async () => {
    const SRC = join(import.meta.dirname, "../../../../src");
    const drawers: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const source = await readFile(file, "utf8");
      if (/consola\.box\(|from\s*["']consola\/utils["']/.test(source)) {
        drawers.push(relative(SRC, file).split(sep).join("/"));
      }
    }

    expect(drawers).toEqual(["lib/term/box.ts"]);
  });
});

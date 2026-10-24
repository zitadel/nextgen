import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { Rail, visibleLength } from "../../../../src/lib/wizard";

/** A rail over a buffer, plus what has been drawn on it. */
function railOver(columns = 80): { rail: Rail; drawn: () => string } {
  const sink = Object.assign(new PassThrough(), { columns });
  let drawn = "";
  sink.on("data", (chunk) => {
    drawn += chunk.toString();
  });
  return { rail: new Rail(sink), drawn: () => drawn };
}

const ESC = "\u001b";

describe("Rail", () => {
  it("draws untouched at the top, where there is no indent", () => {
    const { rail, drawn } = railOver();

    rail.stream.write("hello\nworld\n");

    expect(drawn()).toBe("hello\nworld\n");
  });

  it("indents every line written inside a branch", () => {
    const { rail, drawn } = railOver();
    rail.push("│  ");

    rail.stream.write("one\ntwo\n");

    expect(drawn()).toBe("│  one\n│  two\n");
  });

  it("stacks the indent of nested branches", () => {
    const { rail, drawn } = railOver();
    rail.push("│  ");
    rail.push("│  ");

    rail.stream.write("deep\n");

    expect(drawn()).toBe("│  │  deep\n");
  });

  it("stops indenting when a branch is left", () => {
    const { rail, drawn } = railOver();
    rail.push("│  ");
    rail.pop();

    rail.stream.write("out\n");

    expect(drawn()).toBe("out\n");
  });

  it("keeps the rail unbroken through a blank line", () => {
    const { rail, drawn } = railOver();
    rail.push("│  ");

    rail.stream.write("a\n\nb\n");

    expect(drawn()).toBe("│  a\n│\n│  b\n");
  });

  it("puts the indent before a colour that starts a line, not inside it", () => {
    const { rail, drawn } = railOver();
    rail.push("│  ");

    rail.stream.write(`${ESC}[32mgreen${ESC}[39m\n`);

    expect(drawn()).toBe(`│  ${ESC}[32mgreen${ESC}[39m\n`);
  });

  it("never indents a cursor or erase sequence", () => {
    const { rail, drawn } = railOver();
    rail.push("│  ");

    rail.stream.write(`${ESC}[?25l${ESC}[999D${ESC}[2A${ESC}[Jtext`);

    expect(drawn()).toBe(`${ESC}[?25l${ESC}[999D${ESC}[2A${ESC}[J│  text`);
  });

  it("indents a frame again when it is redrawn from the start of the line", () => {
    const { rail, drawn } = railOver();
    rail.push("│  ");

    rail.stream.write("first\nsecond");
    rail.stream.write(`${ESC}[999D${ESC}[1A${ESC}[Jfirst!\nsecond!`);

    expect(drawn()).toBe(`│  first\n│  second${ESC}[999D${ESC}[1A${ESC}[J│  first!\n│  second!`);
  });

  it("does not indent text that continues a line", () => {
    const { rail, drawn } = railOver();
    rail.push("│  ");

    rail.stream.write("typed");
    rail.stream.write(" more");

    expect(drawn()).toBe("│  typed more");
  });

  it("reports the width left once the indent is taken", () => {
    const { rail } = railOver(80);
    rail.push("│  ");
    rail.push("│  ");

    expect(rail.stream.columns).toBe(74);
  });

  it("counts depth by branches", () => {
    const { rail } = railOver();

    rail.push("│  ");

    expect(rail.depth).toBe(1);
  });
});

describe("visibleLength", () => {
  it("ignores colour codes", () => {
    expect(visibleLength(`${ESC}[1mbold${ESC}[22m`)).toBe(4);
  });
});

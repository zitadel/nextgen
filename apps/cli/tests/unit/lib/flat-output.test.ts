import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import { flatOutput, flatten } from "@/lib/flat-output";

const ERASE = "\u001b[999D\u001b[3A\u001b[J";
const CYAN = "\u001b[36m";
const OFF = "\u001b[39m";

describe("flatten", () => {
  it.each([
    ["an active question", `${CYAN}◆${OFF}  Which design?`, "Which design?"],
    ["an answered question", `${CYAN}◇${OFF}  Which design?`, "Which design?"],
    ["a refused answer's mark", `${CYAN}▲${OFF}  Enter a slug`, "Enter a slug"],
  ])("takes the mark off %s", (_form, drawn, flat) => {
    expect(flatten(drawn)).toBe(flat);
  });

  it("takes the indent off every line under the question", () => {
    expect(flatten("◆  Which?\n  ● Default card\n   ○ Minimal\n")).toBe(
      "Which?\n● Default card\n○ Minimal\n",
    );
  });

  it("keeps the codes that move the cursor, so a redraw still replaces the old frame", () => {
    expect(flatten(`${ERASE}${CYAN}◆${OFF}  Which?\n  ○ Minimal`)).toBe(
      `${ERASE}Which?\n○ Minimal`,
    );
  });

  it("takes the indent off a line clack rewrites in place", () => {
    expect(flatten("\u001b[2K\u001b[G  hi")).toBe("\u001b[2K\u001b[Ghi");
  });

  it("leaves a line with nothing to indent, and the newline that ends it, alone", () => {
    expect(flatten("answer\n")).toBe("answer\n");
  });

  it("leaves spaces inside a line alone", () => {
    expect(flatten("  ● Default card (forked as an editable template)")).toBe(
      "● Default card (forked as an editable template)",
    );
  });
});

describe("flatOutput", () => {
  const terminal = (columns?: number): NodeJS.WriteStream => {
    const stream = new PassThrough() as unknown as NodeJS.WriteStream;
    Object.assign(stream, { columns, rows: 30 });
    return stream;
  };

  it("writes what clack draws to the target, flattened", () => {
    const target = terminal(80);
    const written: string[] = [];
    target.on("data", (chunk: Buffer) => {
      written.push(String(chunk));
    });

    flatOutput(target).write("◇  Remove it?\n  No\n");

    expect(written.join("")).toBe("Remove it?\nNo\n");
  });

  it("reports the target's size, which is how clack wraps and redraws", () => {
    const output = flatOutput(terminal(97));

    expect(output).toMatchObject({ isTTY: true, columns: 97, rows: 30 });
  });

  it("falls back to 80 columns when the target has no width", () => {
    expect(flatOutput(terminal())).toMatchObject({ columns: 80 });
  });

  it("is one stream per target, so many prompts add one resize listener", () => {
    const target = terminal(80);

    expect(flatOutput(target)).toBe(flatOutput(target));
    expect(target.listenerCount("resize")).toBe(1);
  });

  it("passes a resize of the target on to clack", () => {
    const target = terminal(80);
    const resized: string[] = [];
    flatOutput(target).on("resize", () => {
      resized.push("resize");
    });

    target.emit("resize");

    expect(resized).toEqual(["resize"]);
  });

  describe("taking a prompt off the screen", () => {
    const START = "\u001b[?25l";
    const REDRAW = "\u001b[999D\u001b[4A\u001b[J";

    const screen = () => {
      const target = terminal(80);
      const written: string[] = [];
      target.on("data", (chunk: Buffer) => {
        written.push(String(chunk));
      });
      return { target, output: flatOutput(target), written };
    };

    it("backs up over the lines of the prompt that is showing and clears them", () => {
      const { output, written } = screen();
      output.write(`${START}◆  Remove it?\n  ● No\n  ○ Yes\n  ↑/↓ to navigate\n`);

      output.erase();

      expect(written.at(-1)).toBe("\u001b[4A\r\u001b[J");
    });

    it("counts only the last frame of a prompt that was redrawn", () => {
      const { output, written } = screen();
      output.write(`${START}◆  Remove it?\n  ● No\n  ○ Yes\n  ↑/↓ to navigate\n`);
      output.write(`${REDRAW}■  Remove it?\n  No\n`);

      output.erase();

      expect(written.at(-1)).toBe("\u001b[2A\r\u001b[J");
    });

    it("counts a prompt from its own start, not from the ones before it", () => {
      const { output, written } = screen();
      output.write(`${START}◇  First?\n  Yes\n`);
      output.write(`${START}◆  Second?\n  ● No\n`);

      output.erase();

      expect(written.at(-1)).toBe("\u001b[2A\r\u001b[J");
    });

    it("writes nothing when no prompt is showing", () => {
      const { output, written } = screen();

      output.erase();

      expect(written).toEqual([]);
    });

    it("erases a prompt once, however many times it is asked", () => {
      const { output, written } = screen();
      output.write(`${START}◆  Remove it?\n  ● No\n`);

      output.erase();
      output.erase();

      expect(written.filter((chunk) => chunk.includes("\u001b[J"))).toHaveLength(1);
    });
  });
});

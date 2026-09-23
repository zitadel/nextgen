import { describe, expect, it } from "vitest";

import { RunOutput, prefixFor } from "../../../../src/lib/run/output";

/** Collects what the session would have written, with the ANSI colour dropped. */
function recorder() {
  const lines: string[] = [];
  const output = new RunOutput((text) => {
    lines.push(text.replaceAll(/\[\d+m/g, ""));
  });
  return { lines, output };
}

describe("RunOutput", () => {
  it("prefixes every complete line with its source", () => {
    const { lines, output } = recorder();

    output.write("app", "ready\nlistening\n");

    expect(lines).toEqual(["app     │ ready\n", "app     │ listening\n"]);
  });

  it("holds a partial line until the rest of the chunk arrives", () => {
    const { lines, output } = recorder();

    output.write("server", "level=INFO msg=");
    expect(lines).toEqual([]);

    output.write("server", '"listening"\n');
    expect(lines).toEqual(['server  │ level=INFO msg="listening"\n']);
  });

  it("keeps two sources from interleaving mid-line", () => {
    const { lines, output } = recorder();

    output.write("app", "compil");
    output.write("server", "starting\n");
    output.write("app", "ed\n");

    expect(lines).toEqual(["server  │ starting\n", "app     │ compiled\n"]);
  });

  it("drops the carriage return of a CRLF line ending", () => {
    const { lines, output } = recorder();

    output.write("app", "built\r\n");

    expect(lines).toEqual(["app     │ built\n"]);
  });

  it("emits a buffered partial line on flush, once", () => {
    const { lines, output } = recorder();

    output.write("app", "waiting for input");
    output.flush();
    output.flush();

    expect(lines).toEqual(["app     │ waiting for input\n"]);
  });

  it("flushes a source's partial line before the loop's own narration", () => {
    const { lines, output } = recorder();

    output.write("app", "compiling");
    output.line("app", "restarting");

    expect(lines).toEqual(["app     │ compiling\n", "app     │ restarting\n"]);
  });

  it("writes banners without a prefix", () => {
    const { lines, output } = recorder();

    output.raw("Keys  r apply");

    expect(lines).toEqual(["Keys  r apply\n"]);
  });

  it("pads every prefix to the same width", () => {
    const widths = (["app", "cli", "server"] as const).map(
      (source) => prefixFor(source).replaceAll(/\[\d+m/g, "").length,
    );

    expect(new Set(widths).size).toBe(1);
  });
});

import { describe, expect, it } from "vitest";

import { parseVariableValue, readStdin } from "../../../src/lib/variables";

describe("parseVariableValue", () => {
  it("keeps a string exactly as entered", () => {
    expect(parseVariableValue("5", "string")).toEqual({ ok: true, value: "5" });
    expect(parseVariableValue(" padded ", "string")).toEqual({ ok: true, value: " padded " });
  });

  it.each([
    ["5", 5],
    ["-1.5", -1.5],
    ["0", 0],
    ["1e3", 1000],
  ])("reads %j as the number %j", (raw, expected) => {
    expect(parseVariableValue(raw, "number")).toEqual({ ok: true, value: expected });
  });

  it.each(["abc", "", " 5", "5 ", "0x10", "05", "1,000", "NaN", "Infinity"])(
    "refuses %j, which is not a JSON number",
    (raw) => {
      expect(parseVariableValue(raw, "number")).toMatchObject({
        ok: false,
        problem: expect.stringMatching(/Expected a number.*JSON number/),
      });
    },
  );

  it("refuses an integer too large to store exactly, rather than rounding it", () => {
    // 2^53 + 1 has no exact double; stored as a number it would change digits.
    expect(parseVariableValue("9007199254740993", "number")).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/too large.*string/),
    });
    expect(parseVariableValue("9007199254740991", "number")).toEqual({
      ok: true,
      value: 9007199254740991,
    });
  });

  it("reads exactly true and false as booleans", () => {
    expect(parseVariableValue("true", "boolean")).toEqual({ ok: true, value: true });
    expect(parseVariableValue("false", "boolean")).toEqual({ ok: true, value: false });
  });

  it.each(["True", "1", "yes", ""])("refuses %j as a boolean", (raw) => {
    expect(parseVariableValue(raw, "boolean")).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/Expected true or false.*`true` or `false`/),
    });
  });
});

describe("readStdin", () => {
  const streamOf = (...chunks: string[]) =>
    (async function* () {
      yield* chunks;
    })() as unknown as NodeJS.ReadableStream;

  it("joins chunks", async () => {
    expect(await readStdin(streamOf("abc", "def"))).toBe("abcdef");
  });

  it("strips exactly one trailing newline", async () => {
    expect(await readStdin(streamOf("secret\n"))).toBe("secret");
    expect(await readStdin(streamOf("secret\n\n"))).toBe("secret\n");
    expect(await readStdin(streamOf("secret\r\n"))).toBe("secret");
  });

  it("keeps interior whitespace", async () => {
    expect(await readStdin(streamOf("a b\tc"))).toBe("a b\tc");
  });
});

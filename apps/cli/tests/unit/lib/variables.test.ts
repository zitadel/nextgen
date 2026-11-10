import { describe, expect, it } from "vitest";

import { Variable } from "@/lib/backend";
import { inventoryCell, parseVariableValue, readStdin, variableCell } from "@/lib/variables";

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

describe("variableCell", () => {
  it("carries the stored value as the server holds it, for the render boundary to escape", () => {
    expect(variableCell(Variable.of("V", "one\ntwo\u001b[31m"))).toEqual({
      name: "V",
      value: "one\ntwo\u001b[31m",
    });
  });

  it("prints a marker for a secret rather than an empty column", () => {
    expect(variableCell(Variable.of("S", { secret: true }))).toEqual({
      name: "S",
      value: "(secret)",
    });
  });

  it("renders a number or a boolean as its JSON text", () => {
    expect(variableCell(Variable.of("N", 5)).value).toBe("5");
    expect(variableCell(Variable.of("B", false)).value).toBe("false");
  });
});

describe("inventoryCell", () => {
  it("prints a dash for a kind the name holds nothing for", () => {
    const [variable] = Variable.inventory({
      API_URL: {
        preview: "https://preview.acme.com",
      },
    });

    expect(inventoryCell(variable as Variable)).toEqual({
      name: "API_URL",
      value: "-",
      preview: "https://preview.acme.com",
    });
  });

  it("prints a marker for a secret in either column", () => {
    const [variable] = Variable.inventory({
      TOKEN: {
        primary: {
          secret: true,
        },
      },
    });

    expect(inventoryCell(variable as Variable)).toEqual({
      name: "TOKEN",
      value: "(secret)",
      preview: "-",
    });
  });
});

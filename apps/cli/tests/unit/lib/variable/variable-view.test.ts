import { describe, expect, it } from "vitest";

import { Variable } from "@/lib/backend";
import { VariableView } from "@/lib/variable";

describe("VariableView.parse", () => {
  it("keeps a string exactly as entered", () => {
    expect(VariableView.parse("5", "string")).toEqual({ ok: true, value: "5" });
    expect(VariableView.parse(" padded ", "string")).toEqual({ ok: true, value: " padded " });
  });

  it.each([
    ["5", 5],
    ["-1.5", -1.5],
    ["0", 0],
    ["1e3", 1000],
  ])("reads %j as the number %j", (raw, expected) => {
    expect(VariableView.parse(raw, "number")).toEqual({ ok: true, value: expected });
  });

  it.each(["abc", "", " 5", "5 ", "0x10", "05", "1,000", "NaN", "Infinity"])(
    "refuses %j, which is not a JSON number",
    (raw) => {
      expect(VariableView.parse(raw, "number")).toMatchObject({
        ok: false,
        problem: expect.stringMatching(/Expected a number.*JSON number/),
      });
    },
  );

  it("refuses an integer too large to store exactly, rather than rounding it", () => {
    // 2^53 + 1 has no exact double; stored as a number it would change digits.
    expect(VariableView.parse("9007199254740993", "number")).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/too large.*string/),
    });
    expect(VariableView.parse("9007199254740991", "number")).toEqual({
      ok: true,
      value: 9007199254740991,
    });
  });

  it("reads exactly true and false as booleans", () => {
    expect(VariableView.parse("true", "boolean")).toEqual({ ok: true, value: true });
    expect(VariableView.parse("false", "boolean")).toEqual({ ok: true, value: false });
  });

  it.each(["True", "1", "yes", ""])("refuses %j as a boolean", (raw) => {
    expect(VariableView.parse(raw, "boolean")).toMatchObject({
      ok: false,
      problem: expect.stringMatching(/Expected true or false.*is exactly true or false/),
    });
  });
});

describe("VariableView.cell", () => {
  it("carries the stored value as the server holds it, for the render boundary to escape", () => {
    expect(VariableView.of(Variable.of("V", "one\ntwo\u001b[31m")).cell()).toEqual({
      name: "V",
      value: "one\ntwo\u001b[31m",
    });
  });

  it("prints a marker for a secret rather than an empty column", () => {
    expect(VariableView.of(Variable.of("S", { secret: true })).cell()).toEqual({
      name: "S",
      value: "(secret)",
    });
  });

  it("renders a number or a boolean as its JSON text", () => {
    expect(VariableView.of(Variable.of("N", 5)).cell().value).toBe("5");
    expect(VariableView.of(Variable.of("B", false)).cell().value).toBe("false");
  });
});

describe("VariableView.inventoryCell", () => {
  it("prints a dash for a kind the name holds nothing for", () => {
    const [variable] = Variable.inventory({
      API_URL: {
        preview: "https://preview.acme.com",
      },
    });

    expect(VariableView.of(variable as Variable).inventoryCell()).toEqual({
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

    expect(VariableView.of(variable as Variable).inventoryCell()).toEqual({
      name: "TOKEN",
      value: "(secret)",
      preview: "-",
    });
  });
});

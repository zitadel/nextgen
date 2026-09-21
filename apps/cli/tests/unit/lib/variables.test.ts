import { describe, expect, it } from "vitest";

import {
  assertVariableName,
  readStdin,
  renderScalar,
  renderVariableTable,
  toVariableRows,
} from "../../../src/lib/variables";

describe("assertVariableName", () => {
  it("accepts letters, digits and underscores", () => {
    expect(() => assertVariableName("GOOGLE_CLIENT_SECRET")).not.toThrow();
    expect(() => assertVariableName("retry2")).not.toThrow();
  });

  it("rejects anything else", () => {
    for (const bad of ["GOOGLE-CLIENT", "a.b", "a b", ""]) {
      expect(() => assertVariableName(bad)).toThrow(/Invalid variable name/);
    }
  });

  it("enforces the schema's 255-character cap locally", () => {
    expect(() => assertVariableName("A".repeat(255))).not.toThrow();
    expect(() => assertVariableName("A".repeat(256))).toThrow(/the limit is 255/);
  });
});

describe("toVariableRows", () => {
  it("marks secrets as held and carries no value for them", () => {
    const rows = toVariableRows({
      GOOGLE_CLIENT_SECRET: { secret: true },
      GOOGLE_CLIENT_ID: "999-prod",
    });

    expect(rows).toEqual([
      { name: "GOOGLE_CLIENT_ID", secret: false, value: "999-prod" },
      { name: "GOOGLE_CLIENT_SECRET", secret: true },
    ]);
    expect(rows[1]).not.toHaveProperty("value");
  });

  it("keeps a scalar's JSON type", () => {
    expect(toVariableRows({ RETRY_COUNT: 5, DEBUG: true })).toEqual([
      { name: "DEBUG", secret: false, value: true },
      { name: "RETRY_COUNT", secret: false, value: 5 },
    ]);
  });

  it("sorts by name so output is stable between runs", () => {
    const rows = toVariableRows({ B: "2", A: "1", C: "3" });
    expect(rows.map((r) => r.name)).toEqual(["A", "B", "C"]);
  });

  it("reports an owner that holds nothing", () => {
    expect(toVariableRows({})).toEqual([]);
  });
});

describe("renderVariableTable", () => {
  it("escapes a value that would otherwise break the table or the terminal", () => {
    const table = renderVariableTable(toVariableRows({ V: "one\ntwo\u001b[31m" }), "the project");

    expect(table).not.toContain("\u001b");
    expect(table.split("\n")).toHaveLength(4);
  });

  it("prints a marker for a secret rather than an empty column", () => {
    const table = renderVariableTable(
      toVariableRows({ S: { secret: true }, V: "plain" }),
      "the project",
    );
    expect(table).toContain("(secret)");
    expect(table).toContain("plain");
  });

  it("names the owner in the header, as `schemas list` does", () => {
    expect(renderVariableTable(toVariableRows({ V: "x" }), "prod")).toContain(
      "Variables on prod (1)",
    );
    expect(renderVariableTable(toVariableRows({ V: "x" }), "the project")).toContain(
      "Variables on the project (1)",
    );
  });

  it("says so when nothing is entered", () => {
    expect(renderVariableTable([], "prod")).toBe("No variables entered on prod.");
    expect(renderVariableTable([], "the project")).toBe("No variables entered on the project.");
  });
});

describe("renderScalar", () => {
  it("leaves an ordinary value alone", () => {
    expect(renderScalar("999-prod.apps.googleusercontent.com")).toBe(
      "999-prod.apps.googleusercontent.com",
    );
    expect(renderScalar("a b/c=d")).toBe("a b/c=d");
  });

  it("keeps a value on its own row by escaping newlines", () => {
    expect(renderScalar("one\ntwo")).toBe("one\\x0atwo");
    expect(renderScalar("one\r\ntwo")).toBe("one\\x0d\\x0atwo");
  });

  it("neutralises escape sequences that would drive the terminal", () => {
    // OSC 52 writes the clipboard; a raw ESC here would reach the terminal.
    expect(renderScalar("\u001b]52;c;cGF5bG9hZA==\u0007")).toBe("\\x1b]52;c;cGF5bG9hZA==\\x07");
    expect(renderScalar("\u001b[31mred\u001b[0m")).toBe("\\x1b[31mred\\x1b[0m");
  });

  it("escapes non-ASCII format characters too", () => {
    expect(renderScalar("a\u200bb")).toBe("a\\u200bb");
    expect(renderScalar("a\u2028b")).toBe("a\\u2028b");
  });

  it("renders a non-string scalar as itself", () => {
    expect(renderScalar(5)).toBe("5");
    expect(renderScalar(true)).toBe("true");
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

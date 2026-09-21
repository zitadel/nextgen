import { describe, expect, it } from "vitest";

import {
  assertVariableName,
  renderScalar,
  environmentParam,
  ownerLabel,
  parseEnvFile,
  readStdin,
  renderVariableTable,
  toVariableRows,
} from "../../../src/lib/variables";

describe("environmentParam", () => {
  it("omits the query parameter for the project level", () => {
    expect(environmentParam(undefined)).toEqual({});
  });

  it("passes a DNS-style label through", () => {
    expect(environmentParam("prod")).toEqual({ environment_name: "prod" });
    expect(environmentParam("staging-eu")).toEqual({ environment_name: "staging-eu" });
  });

  it("rejects a name the platform's grammar refuses", () => {
    for (const bad of ["Prod", "-prod", "prod-", "pro_d", "pr od"]) {
      expect(() => environmentParam(bad)).toThrow(/Invalid environment name/);
    }
  });

  it("rejects a name longer than the schema allows", () => {
    expect(() => environmentParam("a".repeat(64))).toThrow(/Invalid environment name/);
    expect(environmentParam("a".repeat(63))).toEqual({ environment_name: "a".repeat(63) });
  });
});

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

describe("ownerLabel", () => {
  it("names the project level explicitly", () => {
    expect(ownerLabel(undefined)).toBe("the project");
    expect(ownerLabel("prod")).toBe("prod");
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
    expect(Object.hasOwn(rows[1]!, "value")).toBe(false);
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
    const table = renderVariableTable(toVariableRows({ V: "one\ntwo\u001b[31m" }));

    expect(table).not.toContain("\u001b");
    expect(table.split("\n")).toHaveLength(4);
  });

  it("prints a marker for a secret rather than an empty column", () => {
    const table = renderVariableTable(toVariableRows({ S: { secret: true }, V: "plain" }));
    expect(table).toContain("(secret)");
    expect(table).toContain("plain");
  });

  it("names the owner in the header, as `schemas list` does", () => {
    expect(renderVariableTable(toVariableRows({ V: "x" }), "prod")).toContain(
      "Variables on prod (1)",
    );
    expect(renderVariableTable(toVariableRows({ V: "x" }))).toContain(
      "Variables on the project (1)",
    );
  });

  it("says so when nothing is entered", () => {
    expect(renderVariableTable([], "prod")).toBe("No variables entered on prod.");
    expect(renderVariableTable([])).toBe("No variables entered on the project.");
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

describe("parseEnvFile", () => {
  it("reads KEY=VALUE pairs", () => {
    expect(parseEnvFile("A=1\nB=two\n")).toEqual({ A: "1", B: "two" });
  });

  it("skips blanks and comments", () => {
    expect(parseEnvFile("\n# note\nA=1\n\n")).toEqual({ A: "1" });
  });

  it("strips one matching pair of surrounding quotes", () => {
    expect(parseEnvFile(`A="q"\nB='s'\nC="mixed'`)).toEqual({
      A: "q",
      B: "s",
      C: `"mixed'`,
    });
  });

  it("keeps an equals sign inside the value", () => {
    expect(parseEnvFile("URL=a=b=c")).toEqual({ URL: "a=b=c" });
  });

  it("drops the export prefix", () => {
    expect(parseEnvFile("export A=1")).toEqual({ A: "1" });
  });

  it("does not expand references, so a value is stored verbatim", () => {
    expect(parseEnvFile("A=${B}")).toEqual({ A: "${B}" });
  });

  it("ignores a line with no assignment", () => {
    expect(parseEnvFile("noequals\n=novalue\nA=1")).toEqual({ A: "1" });
  });

  it("keeps __proto__ as an own property rather than losing it", () => {
    const parsed = parseEnvFile("__proto__=payload\nA=1");

    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(Object.keys(parsed).sort()).toEqual(["A", "__proto__"]);
    expect(parsed["__proto__"]).toBe("payload");
    expect(({} as Record<string, unknown>)["payload"]).toBeUndefined();
  });

  it("keeps an empty value, which the scalar schema accepts", () => {
    expect(parseEnvFile("A=\n")).toEqual({ A: "" });
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

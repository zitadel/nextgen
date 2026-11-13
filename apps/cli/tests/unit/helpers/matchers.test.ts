import { describe, expect, it } from "vitest";

const printed = (stdout: string) => ({ exitCode: 0, stdout, stderr: "" });

describe("toPrintRow", () => {
  it("finds the cells on one line whatever the spacing between them", () => {
    expect(printed("  HOST   app.acme.com\n  TOKEN  (secret)")).toPrintRow("HOST", "app.acme.com");
    expect(printed("HOST app.acme.com")).toPrintRow("HOST", "app.acme.com");
  });

  it("does not find cells that are on different lines or in another order", () => {
    expect(printed("HOST\napp.acme.com")).not.toPrintRow("HOST", "app.acme.com");
    expect(printed("app.acme.com   HOST")).not.toPrintRow("HOST", "app.acme.com");
  });

  it("reads a cell as text, not as a pattern", () => {
    expect(printed("a.b   c")).toPrintRow("a.b", "c");
    expect(printed("axb   c")).not.toPrintRow("a.b", "c");
  });
});

describe("toPrintPlainRows", () => {
  it("matches exactly these tab-separated records, apart from the final line terminator", () => {
    expect(printed("a\tb\nc\td\n")).toPrintPlainRows(["a", "b"], ["c", "d"]);
    expect(printed("a\tb\nc\td")).toPrintPlainRows(["a", "b"], ["c", "d"]);
  });

  it("does not match blank records, before, between or after the rows", () => {
    expect(printed("\n")).not.toPrintPlainRows();
    expect(printed("a\tb\n\nc\td\n")).not.toPrintPlainRows(["a", "b"], ["c", "d"]);
    expect(printed("a\tb\n\n")).not.toPrintPlainRows(["a", "b"]);
  });

  it("matches nothing for empty output", () => {
    expect(printed("")).toPrintPlainRows();
  });

  it("does not match a header, an extra record or a space-aligned table", () => {
    expect(printed("id\tname\na\tb")).not.toPrintPlainRows(["a", "b"]);
    expect(printed("a\tb\nc\td")).not.toPrintPlainRows(["a", "b"]);
    expect(printed("a   b")).not.toPrintPlainRows(["a", "b"]);
  });

  it("matches a varying cell by pattern", () => {
    expect(printed("a\t2026-01-01")).toPrintPlainRows(["a", /^\d{4}-/]);
  });
});

describe("toPrintPlainRow", () => {
  it("finds one tab-separated record among others", () => {
    expect(printed("a\tb\nc\td")).toPrintPlainRow("c", "d");
  });

  it("does not find cells split by anything but a tab, or a record with more cells", () => {
    expect(printed("c   d")).not.toPrintPlainRow("c", "d");
    expect(printed("c\td\te")).not.toPrintPlainRow("c", "d");
  });
});

describe("toSuggestOnly", () => {
  /**
   * A finished run whose envelope suggests these commands, spelled out by the runner.
   *
   * @param commands - The commands the run suggested, without the runner.
   * @returns The run as the matchers read it.
   */
  function suggesting(...commands: string[]) {
    return printed(
      JSON.stringify({
        status: "error",
        next_commands: commands.map((command) => {
          return `npx @zitadel/cli@0.6.0 ${command}`;
        }),
      }),
    );
  }

  it("matches exactly these suggestions, in this order, after the runner", () => {
    expect(suggesting("deploy --cwd a", "preview rm u --cwd a")).toSuggestOnly(
      "deploy --cwd a",
      "preview rm u --cwd a",
    );
  });

  it.each([
    ["a missing suggestion", ["deploy --cwd a"], ["deploy --cwd a", "preview rm u"]],
    ["an extra suggestion", ["deploy --cwd a", "preview rm u"], ["deploy --cwd a"]],
    [
      "a reordered suggestion",
      ["deploy --cwd a", "preview rm u"],
      ["preview rm u", "deploy --cwd a"],
    ],
  ])("does not match %s", (_, suggested, expected) => {
    expect(suggesting(...suggested)).not.toSuggestOnly(...expected);
  });

  it("matches no suggestions when the envelope has none", () => {
    expect(printed(JSON.stringify({ status: "error" }))).toSuggestOnly();
  });
});

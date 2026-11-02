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

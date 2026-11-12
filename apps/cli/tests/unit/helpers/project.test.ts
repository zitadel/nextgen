import { describe, expect, it } from "vitest";

import { assertDryRun, assertEndingIsWellFormed, assertOneText } from "@tests/helpers/project";

const run = (stdout: string, stderr = "") => ({ stdout, stderr });

// The ending of `zitadel status` at a colour terminal, as it was when the
// command's own words were read only when bare: the next steps left raw in
// the box and the overview named twice.
const BROKEN = [
  " \u001b[32m\u2502\u001b[39m  Next:                  \u001b[32m\u2502\u001b[39m",
  " \u001b[32m\u2502\u001b[39m    $ npx @zitadel/cli@0.5.0 start   \u001b[32m\u2502\u001b[39m",
  " \u001b[32m\u2502\u001b[39m  Explore all commands:  \u001b[32m\u2502\u001b[39m",
  " \u001b[32m\u2502\u001b[39m  Explore all commands:  \u001b[32m\u2502\u001b[39m",
].join("\n");

describe("assertEndingIsWellFormed", () => {
  it("lets an ending that names the overview once, with its steps laid out, through", () => {
    const well = [
      " \u2502  Next:                     \u2502",
      " \u2502    npx @zitadel/cli@0.5.0 start  \u2502",
      " \u2502  Explore all commands:         \u2502",
    ].join("\n");

    expect(() => assertEndingIsWellFormed(run(well), "status")).not.toThrow();
  });

  it("refuses an ending that names the overview twice", () => {
    expect(() => assertEndingIsWellFormed(run(BROKEN), "status")).toThrow(/overview 2 times/);
  });

  it("refuses a raw `$` command line left inside a box", () => {
    const raw = " \u2502    $ npx @zitadel/cli@0.5.0 start  \u2502";

    expect(() => assertEndingIsWellFormed(run(raw), "status")).toThrow(/raw \$ command line/);
  });

  it("reads the colour away before it looks, so a coloured ending is held to the same rule", () => {
    expect(() => assertEndingIsWellFormed(run("", BROKEN), "status")).toThrow();
  });

  it("refuses a colour code that was spelled out as text instead of applied", () => {
    const doubled = " \u2502  Package   @zitadel/sdk-next (\\x1b[36mpackage.json\\x1b[39m)  \u2502";

    expect(() => assertEndingIsWellFormed(run(doubled), "setup")).toThrow(/colour code as text/);
  });

  it("allows a lone spelled-out colour from a hostile payload, which is not the CLI's pair", () => {
    expect(() =>
      assertEndingIsWellFormed(run("https://app.acme.com\\x1b[31m"), "origin add"),
    ).not.toThrow();
  });

  it("allows a hostile payload's spelled-out clear-screen, which is not a colour", () => {
    expect(() => assertEndingIsWellFormed(run("proj-\\x1b[2Jwiped"), "env add")).not.toThrow();
  });

  it("refuses a command that was folded across lines like prose", () => {
    const folded =
      "Next:\n  $ npx @zitadel/cli@0.5.0 deployment create --release rel_1\n    --server http://localhost:8111\n";

    expect(() => assertEndingIsWellFormed(run(folded), "release create")).toThrow(
      /folds a command across lines/,
    );
  });

  it("allows a command continued with the shell's own backslash", () => {
    const continued =
      "Next:\n  $ npx @zitadel/cli@0.5.0 deployment create --release rel_1 \\\n    --server http://localhost:8111\n";

    expect(() => assertEndingIsWellFormed(run(continued), "release create")).not.toThrow();
  });

  it("allows a plain `$` line outside a box, which a normal command's next steps are", () => {
    expect(() =>
      assertEndingIsWellFormed(run("Next:\n  $ npx @zitadel/cli@0.5.0 start\n"), "origin add"),
    ).not.toThrow();
  });
});

describe("assertDryRun", () => {
  const dryRun = { status: "ok", data: { dry_run: true, title: "Would remove x (dry run)" } };

  it("lets a dry run that says so, with its headline, through", () => {
    expect(() => assertDryRun("origin rm", dryRun)).not.toThrow();
  });

  it("refuses a dry run without a headline in data.title", () => {
    const untitled = { status: "ok", data: { dry_run: true } };

    expect(() => assertDryRun("origin rm", untitled)).toThrow(/data\.title/);
  });

  it("refuses a headline that does not end in (dry run)", () => {
    const plain = { status: "ok", data: { dry_run: true, title: "Would remove x" } };

    expect(() => assertDryRun("origin rm", plain)).toThrow(/\(dry run\)/);
  });

  it("refuses an answer that is not an envelope", () => {
    expect(() => assertDryRun("origin rm", "not json")).toThrow(/parses/);
  });
});

describe("assertOneText", () => {
  const envelope = (body: unknown, exitCode = 0) => ({
    exitCode,
    stdout: JSON.stringify(body),
    stderr: "",
  });
  const said = { status: "ok", data: { title: "Removed x" }, warnings: ["careful"] };

  it("lets a screen that says the headline and each warning once through", () => {
    const screen = { exitCode: 0, stdout: "Removed x\n", stderr: "Warning: careful\n" };

    expect(() => assertOneText(envelope(said), screen)).not.toThrow();
  });

  it("refuses a warning the screen never shows", () => {
    const screen = { exitCode: 0, stdout: "Removed x\n", stderr: "" };

    expect(() => assertOneText(envelope(said), screen)).toThrow(/exactly once/);
  });

  it("refuses a warning the screen shows twice", () => {
    const screen = { exitCode: 0, stdout: "Removed x\n", stderr: "careful\ncareful\n" };

    expect(() => assertOneText(envelope(said), screen)).toThrow(/exactly once/);
  });

  it("refuses runs that ended differently", () => {
    const screen = { exitCode: 1, stdout: "Removed x\n", stderr: "careful\n" };

    expect(() => assertOneText(envelope(said), screen)).toThrow(/ended the same way/);
  });

  it("refuses an envelope run that printed no envelope", () => {
    const screen = { exitCode: 0, stdout: "Removed x\n", stderr: "" };

    expect(() => assertOneText({ exitCode: 0, stdout: "oops", stderr: "" }, screen)).toThrow(
      /parses/,
    );
  });
});

import { describe, expect, it } from "vitest";

import { assertEndingIsWellFormed } from "@tests/helpers/project";

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
      " \u2502  Run next:                     \u2502",
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

  it("allows a plain `$` line outside a box, which a normal command's next steps are", () => {
    expect(() =>
      assertEndingIsWellFormed(run("Next:\n  $ npx @zitadel/cli@0.5.0 start\n"), "origin add"),
    ).not.toThrow();
  });
});

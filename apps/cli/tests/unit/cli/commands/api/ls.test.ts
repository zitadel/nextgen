import { describe, expect, it } from "vitest";

import { asTerminal } from "@tests/helpers/terminal";
import { parseJson, runCliForTest, stripAnsi } from "@tests/helpers/run-cli";

/** `api ls` reads the spec the CLI was built with, so it contacts nothing. */
const listed = (...args: string[]) =>
  asTerminal(() => runCliForTest(["api", "ls", ...args, "--non-interactive", "--no-telemetry"]));

describe("zitadel api ls", () => {
  it("counts its operations the way every other list counts", async () => {
    const res = await listed("sessions");

    expect(res.exitCode).toBe(0);
    // The count closes the run, so it is the clause the ending makes of it.
    expect(stripAnsi(res.stdout)).toMatch(/^Found \d+ operations$/m);
  });

  it("ends on one short line rather than a paragraph of its own", async () => {
    const res = await listed("sessions");

    const shown = stripAnsi(res.stdout);
    expect(res.exitCode).toBe(0);
    expect(shown.match(/^Found \d+ operations$/gm)).toHaveLength(1);
    expect(shown).toContain("createSession");
    // The count is a line of its own, so it becomes the footer's clause
    // instead of a sentence of prose that wraps under the table. What to do
    // with an operation is `--help`'s job.
    expect(shown).not.toMatch(/\d+ operations\. Call one/);
    expect(shown).not.toContain("--json has each one's parameters");
    expect(shown).not.toContain("Call one with");
  });

  it("says it found nothing, rather than heading an empty table", async () => {
    const res = await listed("zzzznotanoperation");

    expect(res.exitCode).toBe(0);
    const shown = stripAnsi(res.stdout);
    expect(shown).toContain("No operations found");
    expect(shown).not.toMatch(/^id {2,}method/m);
  });

  it("points at calling one by its id, in the envelope as well as on the screen", async () => {
    const res = await runCliForTest(["api", "ls", "sessions", "--json", "--no-telemetry"]);

    expect(parseJson(res.stdout)).toMatchObject({
      data: { next_commands: [expect.stringContaining("api '<operation-id>'")] },
    });
  });

  it("points at the full list when the filter matched nothing", async () => {
    const res = await runCliForTest([
      "api",
      "ls",
      "zzzznotanoperation",
      "--json",
      "--no-telemetry",
    ]);

    expect(parseJson(res.stdout)).toMatchObject({
      data: { next_commands: [expect.stringMatching(/ api ls$/)] },
    });
  });

  it("leaves the machine form alone", async () => {
    const res = await runCliForTest([
      "api",
      "ls",
      "sessions",
      "--non-interactive",
      "--no-telemetry",
    ]);

    const rows = res.stdout.trim().split("\n");
    expect(rows[0]?.split("\t")[0]).toBe("createSession");
    expect(res.stdout).not.toContain("operations");
  });
});

import { describe, expect, it } from "vitest";
import { thrownBy } from "@tests/helpers/thrown-value";

import { ZitadelError } from "@/lib/errors";
import { Failure } from "@/cli/core/failure";
import { RunContext } from "@/cli/core/run-context";
import { commandOf } from "@/lib/suggestion";

const META = {
  ...RunContext.fallback("1.2.3"),
  command: "variable:get",
  source: "https://z.example",
};
const HELP = commandOf(["--help"], "1.2.3");

describe("Failure", () => {
  it("writes the envelope with the run's command and server", () => {
    const failure = new Failure(
      new ZitadelError("E_VALIDATION", "nope", { hint: "try again" }),
      META,
      HELP,
    );

    expect(failure.envelope()).toMatchObject({
      status: "error",
      cli_version: "1.2.3",
      command: "variable:get",
      source: "https://z.example",
      code: "E_VALIDATION",
      message: "nope",
      hint: "try again",
    });
  });

  it("draws the failure as a coded sentence with its hint", () => {
    const summary = new Failure(
      new ZitadelError("E_VALIDATION", "nope", { hint: "try again" }),
      META,
      HELP,
    ).summary();

    expect(summary.title).toBe("Error: nope (E_VALIDATION)");
    expect(summary.lines).toEqual(["try again"]);
    expect(summary.failed).toBe(true);
  });

  it("refuses to report a follow-up nobody rendered", () => {
    const failure = new Failure(
      new ZitadelError("E_VALIDATION", "nope", { nextCommands: [{ id: "doctor" }] }),
      META,
      HELP,
    );

    expect(thrownBy(() => failure.envelope())).toMatchObject({
      message: "doctor was reported without being rendered",
    });
  });
});

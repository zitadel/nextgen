import { describe, expect, it } from "vitest";

import { nextSteps, summaryOfText } from "../../../../src/lib/oclif/result-summary";

describe("summaryOfText", () => {
  it("closes on the line that says what happened, not the first line", () => {
    const summary = summaryOfText("Some detail\n\nSet GREETING on the project");

    expect(summary.title).toBe("Set GREETING on the project");
  });

  it("drops the trailing full stop, so a closing line is a label", () => {
    expect(summaryOfText("Removed GREETING from the project.").title).toBe(
      "Removed GREETING from the project",
    );
  });

  it("turns a bare count into a sentence", () => {
    expect(summaryOfText("1 variable").title).toBe("Found 1 variable");
  });

  it("counts a thing whose name is two words, which a tighter pattern missed", () => {
    expect(summaryOfText("1 flow definition").title).toBe("Found 1 flow definition");
  });

  it("takes the server out of the body and says where it ran instead", () => {
    const summary = summaryOfText("Done\n(server: api.zitadel.cloud)");

    expect(summary.ran).toBe("api.zitadel.cloud");
    expect(summary.lines).not.toContain("(server: api.zitadel.cloud)");
  });

  it("puts a failure's next steps through the box, so no raw Next: survives", () => {
    const summary = summaryOfText("Error E_X: broke\nNext:\n  $ zitadel deploy", true);

    expect(summary.failed).toBe(true);
    expect(summary.boxed).toBe(true);
    expect(summary.next).toEqual([{ text: "Run next:", command: "zitadel deploy" }]);
  });

  it("leaves a table alone rather than reading its first row as a headline", () => {
    const summary = summaryOfText("name      value\n--------  -----\nGREETING  hello");

    expect(summary.title).toBe("Done");
    expect(summary.lines?.[0]).toBe("name      value");
  });
});

describe("nextSteps", () => {
  it("keeps commands under the sentence that introduces them", () => {
    expect(nextSteps(["Deploy it:", "  $ zitadel deploy"])).toEqual([
      { text: "Deploy it:", command: "zitadel deploy" },
    ]);
  });

  it("gives commands nothing introduces the one standard label", () => {
    expect(nextSteps(["$ zitadel deploy", "$ zitadel status"])).toEqual([
      { text: "Run next:", command: "zitadel deploy\nzitadel status" },
    ]);
  });

  it("keeps a standalone sentence apart from the commands after it", () => {
    expect(nextSteps(["Check it in the browser.", "$ zitadel status"])).toEqual([
      { text: "Check it in the browser." },
      { text: "Run next:", command: "zitadel status" },
    ]);
  });

  it("lifts a command named after a colon onto its own line", () => {
    expect(nextSteps(["Check what resolves: zitadel env --env-file .env"])).toEqual([
      { text: "Check what resolves:", command: "zitadel env --env-file .env" },
    ]);
  });
});

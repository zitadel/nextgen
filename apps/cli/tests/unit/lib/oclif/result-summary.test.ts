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

describe("a boxed command that never said Next:", () => {
  // `env add` writes three instructions, each deliberately on its own line.
  // Poured into the steps they came back as one run-on paragraph with three
  // pasteable commands buried in it.
  const text = [
    "Added the staging environment, bound to proj-1",
    "",
    ".env.staging.local holds ZITADEL_URL, ZITADEL_PROJECT_ID.",
    "",
    "Nothing is deployed to staging yet, so it serves the server's defaults.",
    "Deploy to it: zitadel deploy --env-file .env.staging.local",
    "Check what resolves: zitadel env --env-file .env.staging.local",
  ].join("\n");

  it("keeps the body lines it wrote apart instead of running them together", () => {
    const summary = summaryOfText(text, false, true);

    expect(summary.lines).toContain(".env.staging.local holds ZITADEL_URL, ZITADEL_PROJECT_ID.");
    expect(summary.lines).toContain(
      "Nothing is deployed to staging yet, so it serves the server's defaults.",
    );
  });

  it("lifts only the lines that name a command into the steps", () => {
    expect(summaryOfText(text, false, true).next).toEqual([
      { text: "Deploy to it:", command: "zitadel deploy --env-file .env.staging.local" },
      { text: "Check what resolves:", command: "zitadel env --env-file .env.staging.local" },
    ]);
  });

  // `pull` listed the files it had just written, and every one of them was
  // drawn as a command to run.
  it("leaves a list under its heading in the body rather than offering it as commands", () => {
    const summary = summaryOfText(
      "Pulled 2 files from rel_1\n\nFiles written:\n  .zitadel/schemas/user.json\n  .zitadel/flows/login.json",
      false,
      true,
    );

    expect(summary.next).toEqual([]);
    expect(summary.lines).toContain("Files written:");
    expect(summary.lines).toContain("  .zitadel/schemas/user.json");
  });

  it("never offers a variable assignment as something to execute", () => {
    const summary = summaryOfText(
      "Added it\n\nHosting platform, production scope:\n  ZITADEL_URL=https://api.zitadel.cloud\n  ZITADEL_PROJECT_SECRET  (secret, copy it from .env.staging.local)",
      false,
      true,
    );

    expect(
      summary.next?.flatMap((step) => (step.command === undefined ? [] : [step.command])),
    ).toEqual([]);
  });

  it("still lifts a bare command line into the one standard label", () => {
    const summary = summaryOfText("Did it\n\nSomething happened.\n$ zitadel deploy", false, true);

    expect(summary.next).toEqual([{ text: "Run next:", command: "zitadel deploy" }]);
    expect(summary.lines).toContain("Something happened.");
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

// Every failure reads the same way, whatever its message happens to measure.
// Cutting a long one down to its code and then repeating the whole message
// underneath gave one failure two shapes — `Error E_NETWORK: POST … got no
// response` for a short URL and `Error E_NETWORK` plus the same sentence again
// for a long one — so the sentence is the headline and is said once.
describe("a failure whose message is longer than a line", () => {
  const long = `Error E_NOT_FOUND: GET ${"http://host/deployments?project_id=x&live=true".repeat(3)} returned 404`;

  it("closes on the whole sentence, as a short failure does", () => {
    expect(summaryOfText(long, true).title).toBe(long);
  });

  it("does not say it a second time underneath", () => {
    expect(summaryOfText(long, true).lines ?? []).toEqual([]);
  });

  it("leaves a failure that already fits alone", () => {
    expect(summaryOfText("Error E_NOT_FOUND: variable not found", true).title).toBe(
      "Error E_NOT_FOUND: variable not found",
    );
  });

  // A success's headline is a label, and a label nobody can read is worth
  // nothing, so that one is still replaced and said in full underneath.
  it("still shortens a success nobody could read", () => {
    const wordy = `Deployed ${"and on ".repeat(20)}`;

    expect(summaryOfText(wordy).title).toBe("Done");
    expect(summaryOfText(wordy).lines?.[0]).toBe(wordy.trimEnd());
  });
});

// One sentence for every cancellation, so a declined confirmation and an
// interrupted wizard end on the same words. It claims nothing about what was
// changed, because a `*-cancelled` skip and a Ctrl-C land in different places.
describe("a run the person stopped", () => {
  it("closes on the one cancellation sentence", () => {
    expect(summaryOfText("Skipped: remove-cancelled").title).toBe("Cancelled");
  });
});

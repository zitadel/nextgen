import { stripVTControlCharacters as stripAnsi } from "node:util";
import { afterEach, describe, expect } from "vitest";

import { log } from "@/lib/ui";
import { Asker } from "@/cli/core";
import { toZitadelError, ZitadelError } from "@/lib/errors";
import { asTerminal } from "@tests/fixtures/terminal";
import { DrawnSpinner } from "@/lib/ui/spinner";
import { Ui } from "@/lib/ui/ui";
import { it } from "@tests/unit/lib/ui/at-terminal";
import { answering, type Terminal } from "@tests/helpers/keyboard";

const watched = () => new Ui({ interactive: true, force: false });
const normally = () => new Ui({ interactive: true, force: false }, "plain");
const forced = () => new Ui({ interactive: true, force: true });
const scripted = () => new Ui({ interactive: false, force: false });

afterEach(() => {
  DrawnSpinner.active.clear();
});

const printed = (terminal: Terminal) => stripAnsi(terminal.plain());
const errors = (terminal: Terminal) => stripAnsi(terminal.errors());

describe("Ui", () => {
  describe("the questions a command may ask", () => {
    it("opens the chain the question is drawn in", async () => {
      const person = answering(true);
      const ui = watched();
      ui.describe("Removing an origin");

      await Asker.for(ui.session()).yesNo({ name: "remove the origin", message: "Remove it?" });

      expect(printed(person)).toContain("┌  Removing an origin");
    });

    it("is never asked when nobody is watching", async ({ terminal }) => {
      await expect(
        Asker.for(scripted().session()).yesNo({ name: "remove the origin", message: "Remove it?" }),
      ).rejects.toMatchObject({ code: "E_VALIDATION" });
      expect(printed(terminal)).toBe("");
    });

    it("lets the command's --force answer a destructive confirmation", async ({ terminal }) => {
      const answer = await Asker.for(forced().session()).confirm({
        name: "remove the origin",
        message: "Remove it?",
      });

      expect(answer).toBe(true);
      expect(printed(terminal)).toBe("");
    });

    it("asks a plain yes or no anyway, whatever the command's --force means", async () => {
      const person = answering(false);

      const answer = await Asker.for(forced().session()).yesNo({
        name: "scaffold the app",
        message: "Scaffold?",
      });

      expect(answer).toBe(false);
      expect(person.asked()).toEqual(["Scaffold?"]);
    });
  });

  describe("a run that never finished", () => {
    it("stays quiet when the person cancelled, because the prompt already said so", async () => {
      const person = answering(undefined);
      const ui = watched();
      ui.describe("Listing origins");
      const cancelled = await asTerminal(() => {
        return Asker.for(ui.session()).yesNo({ name: "list them", message: "List them?" });
      }).catch((error: unknown) => error);

      const asked = printed(person);

      ui.stop(toZitadelError(cancelled));

      expect(printed(person)).toBe(asked);
    });

    it("closes the chain when the person interrupted the work", ({ terminal }) => {
      const ui = watched();
      ui.describe("Listing origins");
      ui.say("something happened");

      ui.stop(new ZitadelError("E_CANCELLED", "Cancelled"));

      expect(printed(terminal)).toMatch(/└ +Cancelled/);
    });
  });

  describe("what it says about itself", () => {
    it("knows nobody is watching under --json or without a terminal", () => {
      expect(scripted().interactive).toBe(false);
    });

    it("knows the chain is still closed until something is drawn", () => {
      const ui = watched();
      ui.describe("Listing origins");

      expect(ui.opened).toBe(false);

      ui.say("something happened");

      expect(ui.opened).toBe(true);
    });
  });

  describe("drawing outside a question", () => {
    it("names the chain by what the command is doing", ({ terminal }) => {
      const ui = watched();
      ui.describe("Listing origins");
      ui.say("something happened");

      expect(printed(terminal)).toContain("┌  Listing origins");
    });

    it("says where the command ran, as the last line of its summary", ({ terminal }) => {
      const ui = watched();
      ui.ranAgainst("proj-1", "preview.zitadel.com");
      ui.finish({
        title: "Removed the origin",
        sections: [],
        next: [{ text: "Deploy it:", command: "zitadel deploy" }],
        boxed: true,
      });

      expect(printed(terminal)).toContain(
        "Using project proj-1 on your Zitadel server at preview.zitadel.com.",
      );
    });

    // A normal command says the same fact in the footer's own words. Grepping
    // for the box's wording here asserts nothing: only the boxed renderer
    // ever writes "Using".
    it("says it in the footer's words for a normal command", ({ terminal }) => {
      const ui = normally();
      ui.ranAgainst("proj-1", "preview.zitadel.com");
      ui.finish({ title: "Removed the origin", sections: [] });

      expect(printed(terminal)).toContain(
        "Removed the origin · project proj-1 on preview.zitadel.com",
      );
    });

    // `setup` is the one command whose report is the whole point of the run,
    // so it has to show one off a terminal too, where nothing is drawn.
    it("hands back the ending as text, for a command that has to show one anyway", () => {
      const text = scripted().ending({
        title: "Zitadel is ready",
        sections: [],
        lines: ["Project id   proj-1"],
        next: [{ text: "Start your project:", command: "npm run dev" }],
        boxed: true,
        boxTitle: "Zitadel is ready",
      });

      expect(stripAnsi(text)).toContain("Zitadel is ready");
      expect(stripAnsi(text)).toContain("Project id   proj-1");
      expect(stripAnsi(text)).toContain("npm run dev");
    });

    it("writes nothing of its own when it hands the ending back", ({ terminal }) => {
      scripted().ending({ title: "Zitadel is ready", sections: [], boxed: true });

      expect(printed(terminal)).toBe("");
    });

    it("hands out a spinner that draws nothing when nobody is watching", ({ terminal }) => {
      scripted().spinner("Fetching users").stop("Fetched 3 users");

      expect(printed(terminal)).toBe("");
    });

    it("hands out a spinner that draws when somebody is", () => {
      watched().spinner("Fetching users");

      expect(DrawnSpinner.active.size).toBe(1);
    });
  });

  describe("the narration", () => {
    it("draws what a command says inside the chain", ({ terminal }) => {
      const ui = watched();
      ui.describe("Listing origins");
      ui.printLogs();

      log.info("Looking for a project");
      ui.stopPrintingLogs();

      expect(printed(terminal)).toContain("┌  Listing origins");
    });

    // What a line of narration says belongs to the command, so a wizard's
    // goes through the chain whether or not it can be drawn: written, it
    // carries the chain's mark.
    it("takes a wizard's lines even when nobody is watching", ({ terminal }) => {
      const ui = scripted();

      ui.printLogs();
      log.info("the flow was edited by hand");
      ui.stopPrintingLogs();

      expect(printed(terminal)).toContain("the flow was edited by hand");
    });

    it("says a normal command's lines plainly, with no mark and no chain", ({ terminal }) => {
      const ui = normally();

      ui.printLogs();
      log.info("Wrote .zitadel/idps/google.json");
      log.info("Callback URI   https://example.com/callback");
      ui.stopPrintingLogs();

      expect(printed(terminal)).toBe(
        "Wrote .zitadel/idps/google.json\nCallback URI   https://example.com/callback\n",
      );
      expect(printed(terminal)).not.toContain("┌");
    });

    it("says a normal command's warning on stderr, named, so it is not taken for the answer", ({
      terminal,
    }) => {
      const ui = normally();

      ui.printLogs();
      log.warn("the flow was edited by hand");
      ui.stopPrintingLogs();

      expect([errors(terminal), printed(terminal)]).toEqual([
        "Warning: the flow was edited by hand\n",
        "",
      ]);
    });

    it("keeps debug detail back unless it was asked for", ({ terminal }) => {
      const ui = normally();

      ui.printLogs();
      log.debug("an internal detail");
      ui.stopPrintingLogs();

      expect(printed(terminal)).toBe("");
    });

    it("stops drawing into its chain once released, and writes a later line plainly", ({
      terminal,
    }) => {
      const ui = watched();

      ui.printLogs();
      ui.stopPrintingLogs();
      log.info("after the command ended");

      expect(printed(terminal)).toBe("after the command ended\n");
    });
  });

  describe("the ending it hands back as text", () => {
    const summary = {
      title: "Checked the status of the project",
      sections: [],
      next: [{ text: "Next:", command: "npx @zitadel/cli@0.1.0 start" }],
      boxed: true,
    };

    // `setup` renders its own report, so the run has already ended: a second
    // ending from the base command would say the whole thing twice.
    it("remembers that the command took its own ending away", () => {
      const ui = scripted();

      expect(ui.reported).toBe(false);

      ui.ending(summary);

      expect(ui.reported).toBe(true);
    });

    it("is not reported by a command that only had its ending written for it", () => {
      const ui = scripted();

      ui.written(summary);

      expect(ui.reported).toBe(false);
    });
  });
});

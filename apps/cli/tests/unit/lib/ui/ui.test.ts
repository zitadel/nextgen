import { stripVTControlCharacters as stripAnsi } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("@tests/helpers/clack")).clackDouble());

import { confirm, intro, outro, spinner } from "@clack/prompts";

import { log } from "@/lib/log";
import { PromptCancelled, ZitadelError } from "@/lib/errors";
import { Ui } from "@/lib/ui/ui";

const watched = () => new Ui({ interactive: true, force: false });
const normally = () => new Ui({ interactive: true, force: false }, "plain");
const forced = () => new Ui({ interactive: true, force: true });
const scripted = () => new Ui({ interactive: false, force: false });

let written: string[] = [];
let errors: string[] = [];

beforeEach(() => {
  written = [];
  errors = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    errors.push(stripAnsi(String(chunk)));
    return true;
  });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(stripAnsi(String(chunk)));
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

const printed = () => written.join("");

describe("Ui", () => {
  describe("the questions a command may ask", () => {
    it("opens the chain the question is drawn in", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(true as never);
      const ui = watched();
      ui.describe("Removing an origin");

      await ui.questions().yesNo({ name: "remove the origin", message: "Remove it?" });

      expect(intro).toHaveBeenCalledWith("Removing an origin");
    });

    it("is never asked when nobody is watching", async () => {
      await expect(
        scripted().questions().yesNo({ name: "remove the origin", message: "Remove it?" }),
      ).rejects.toMatchObject({ code: "E_VALIDATION" });
      expect(confirm).not.toHaveBeenCalled();
      expect(printed()).toBe("");
    });

    it("lets the command's --force answer a destructive confirmation", async () => {
      const answer = await forced()
        .confirmer()
        .confirm({ name: "remove the origin", message: "Remove it?" });

      expect(answer).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("asks a plain yes or no anyway, whatever the command's --force means", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false as never);

      const answer = await forced()
        .questions()
        .yesNo({ name: "scaffold the app", message: "Scaffold?" });

      expect(answer).toBe(false);
      expect(confirm).toHaveBeenCalled();
    });
  });

  describe("a run that never finished", () => {
    it("stays quiet when the person cancelled, because the prompt already said so", () => {
      const ui = watched();
      ui.describe("Listing origins");
      ui.say("something happened");

      ui.stop(new PromptCancelled());

      expect(outro).not.toHaveBeenCalled();
    });

    it("closes the chain when the person interrupted the work", () => {
      const ui = watched();
      ui.describe("Listing origins");
      ui.say("something happened");

      ui.stop(new ZitadelError("E_CANCELLED", "Cancelled"));

      expect(outro).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
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
    it("names the chain by what the command is doing", () => {
      const ui = watched();
      ui.describe("Listing origins");
      ui.say("something happened");

      expect(intro).toHaveBeenCalledWith("Listing origins");
    });

    it("says where the command ran, as the last line of its summary", () => {
      const ui = watched();
      ui.ranAgainst("proj-1", "api.zitadel.cloud");
      ui.finish({
        title: "Removed the origin",
        sections: [],
        next: [{ text: "Deploy it:", command: "zitadel deploy" }],
        boxed: true,
      });

      expect(printed()).toContain(
        "Using project proj-1 on your Zitadel server at api.zitadel.cloud.",
      );
    });

    // A normal command says the same fact in the footer's own words. Grepping
    // for the box's wording here asserts nothing: only the boxed renderer
    // ever writes "Using".
    it("says it in the footer's words for a normal command", () => {
      const ui = normally();
      ui.ranAgainst("proj-1", "api.zitadel.cloud");
      ui.finish({ title: "Removed the origin", sections: [] });

      expect(printed()).toContain("Removed the origin · project proj-1 on api.zitadel.cloud");
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

    it("writes nothing of its own when it hands the ending back", () => {
      scripted().ending({ title: "Zitadel is ready", sections: [], boxed: true });

      expect(printed()).toBe("");
    });

    it("hands out a spinner that draws nothing when nobody is watching", () => {
      scripted().spinner("Fetching users").stop("Fetched 3 users");

      expect(spinner).not.toHaveBeenCalled();
    });

    it("hands out a spinner that draws when somebody is", () => {
      watched().spinner("Fetching users");

      expect(spinner).toHaveBeenCalled();
    });
  });

  describe("the narration", () => {
    it("draws what a command says inside the chain", () => {
      const ui = watched();
      ui.describe("Listing origins");
      ui.bridgeNarration();

      log.info("Looking for a project");
      ui.releaseNarration();

      expect(intro).toHaveBeenCalledWith("Listing origins");
    });

    // What a line of narration says belongs to the command, so a wizard's
    // goes through the chain whether or not it can be drawn: written, it
    // carries the chain's mark.
    it("takes a wizard's lines even when nobody is watching", () => {
      const ui = scripted();

      ui.bridgeNarration();
      log.info("the flow was edited by hand");
      ui.releaseNarration();

      expect(printed()).toContain("the flow was edited by hand");
    });

    it("says a normal command's lines plainly, with no mark and no chain", () => {
      const ui = normally();

      ui.bridgeNarration();
      log.done("Wrote .zitadel/idps/google.json");
      log.info("Callback URI   https://example.com/callback");
      ui.releaseNarration();

      expect(printed()).toBe(
        "Wrote .zitadel/idps/google.json\nCallback URI   https://example.com/callback\n",
      );
      expect(intro).not.toHaveBeenCalled();
    });

    it("says a normal command's warning on stderr, named, so it is not taken for the answer", () => {
      const ui = normally();

      ui.bridgeNarration();
      log.warn("the flow was edited by hand");
      ui.releaseNarration();

      expect([errors.join(""), printed()]).toEqual(["Warning: the flow was edited by hand\n", ""]);
    });

    it("keeps debug detail back unless it was asked for", () => {
      const ui = normally();

      ui.bridgeNarration();
      log.debug("an internal detail");
      ui.releaseNarration();

      expect(printed()).toBe("");
    });

    it("stops drawing into its chain once released, and writes a later line plainly", () => {
      const ui = watched();

      ui.bridgeNarration();
      ui.releaseNarration();
      log.info("after the command ended");

      expect(printed()).toBe("after the command ended\n");
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

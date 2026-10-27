import { stripAnsi } from "consola/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { confirm, intro, outro, spinner } from "@clack/prompts";
import { consola } from "consola";

import { ZitadelError } from "../../../../src/lib/errors";
import { Ui } from "../../../../src/lib/ui/ui";

const watched = () => new Ui({ interactive: true, force: false });
const normally = () => new Ui({ interactive: true, force: false }, "plain");
const forced = () => new Ui({ interactive: true, force: true });
const scripted = () => new Ui({ interactive: false, force: false });

let written: string[] = [];
let level = 0;

beforeEach(() => {
  written = [];
  // Off a terminal consola reports warnings and above only.
  level = consola.level;
  consola.level = 5;
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(stripAnsi(String(chunk)));
    return true;
  });
});

afterEach(() => {
  consola.level = level;
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

      await ui.questions().confirm({ name: "remove the origin", message: "Remove it?" });

      expect(intro).toHaveBeenCalledWith("Removing an origin");
    });

    it("is never asked when nobody is watching", async () => {
      await expect(
        scripted().questions().confirm({ name: "remove the origin", message: "Remove it?" }),
      ).rejects.toMatchObject({ code: "E_VALIDATION" });
      expect(confirm).not.toHaveBeenCalled();
      expect(printed()).toBe("");
    });

    it("lets the command's --force answer its confirmations", async () => {
      const answer = await forced()
        .questions()
        .confirm({ name: "remove the origin", message: "Remove it?" });

      expect(answer).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("asks anyway when the command's --force means something else", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false as never);

      const answer = await forced()
        .questions({ honorForce: false })
        .confirm({ name: "scaffold the app", message: "Scaffold?" });

      expect(answer).toBe(false);
      expect(confirm).toHaveBeenCalled();
    });

    // The force policy belongs to the asker, not to the chain it draws in, so
    // asking for another asker cannot change what an existing one answers.
    it("settles --force per asker, so one of them never changes another", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false as never);
      const ui = forced();
      const scaffolding = ui.questions({ honorForce: false });
      ui.questions();

      const answer = await scaffolding.confirm({
        name: "scaffold the app",
        message: "Scaffold?",
      });

      expect(answer).toBe(false);
      expect(confirm).toHaveBeenCalledOnce();
    });
  });

  describe("a run that never finished", () => {
    it("stays quiet when the person cancelled, because the prompt already said so", () => {
      const ui = watched();
      ui.describe("Listing origins");
      ui.say("something happened");

      ui.stop(new ZitadelError("E_CANCELLED", "Cancelled by user"));

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

  describe("the consola bridge", () => {
    it("draws a command's consola lines inside the chain", () => {
      const ui = watched();
      ui.describe("Listing origins");
      ui.bridgeNarration();

      consola.info("Looking for a project");
      ui.releaseNarration();

      expect(intro).toHaveBeenCalledWith("Listing origins");
    });

    it("is never installed when nobody is watching", () => {
      const before = [...consola.options.reporters];
      const ui = scripted();

      ui.bridgeNarration();

      expect(consola.options.reporters).toEqual(before);
      ui.releaseNarration();
    });
  });
});

import { stripAnsi } from "consola/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { confirm, intro, outro, spinner } from "@clack/prompts";
import { consola } from "consola";

import { ZitadelError } from "../../../../src/lib/errors";
import { outcome } from "../../../../src/lib/ui/summary";
import { Ui } from "../../../../src/lib/ui/ui";

const watched = () => new Ui({ interactive: true, force: false });
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
const done = <D>(data: D, title: string) => outcome(data, { title, sections: [] });

describe("Ui", () => {
  describe("a command run as one chain", () => {
    it("returns the data the command produced", async () => {
      await expect(
        watched().wizard("Listing origins", async () => done({ count: 1 }, "Found 1 origin")),
      ).resolves.toEqual({ count: 1 });
    });

    it("closes the chain on the summary the command returned", async () => {
      await watched().wizard("Listing origins", async () => done(null, "Found 1 origin"));

      expect(intro).toHaveBeenCalledWith("Listing origins");
      expect(outro).toHaveBeenCalledWith("Found 1 origin");
    });

    it("draws nothing at all when nobody is watching", async () => {
      await scripted().wizard("Listing origins", async () => done(null, "Found 1 origin"));

      expect(intro).not.toHaveBeenCalled();
      expect(outro).not.toHaveBeenCalled();
      expect(printed()).toBe("");
    });

    it("says the run stopped, and lets the error through, when the work threw", async () => {
      const boom = new Error("boom");

      await expect(
        watched().wizard("Listing origins", async (w) => {
          w.say("Looking for a project");
          throw boom;
        }),
      ).rejects.toBe(boom);
      expect(outro).toHaveBeenCalledWith(expect.stringContaining("Stopped"));
    });

    it("stays quiet when the person cancelled, because the prompt already said so", async () => {
      await watched()
        .wizard("Listing origins", async (w) => {
          w.say("Looking for a project");
          throw new ZitadelError("E_CANCELLED", "Cancelled by user");
        })
        .catch(() => undefined);

      expect(outro).not.toHaveBeenCalled();
    });

    it("lets the command's --force answer its confirmations", async () => {
      const answer = await forced().wizard("Removing an origin", async (w) =>
        done(await w.confirm({ name: "remove the origin", message: "Remove it?" }), "Removed"),
      );

      expect(answer).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    });

    it("asks anyway when the command's --force means something else", async () => {
      vi.mocked(confirm).mockResolvedValueOnce(false as never);

      const answer = await forced().wizard(
        "Setting up",
        async (w) =>
          done(await w.confirm({ name: "scaffold the app", message: "Scaffold?" }), "Set up"),
        { honorForce: false },
      );

      expect(answer).toBe(false);
      expect(confirm).toHaveBeenCalled();
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

      ui.open();

      expect(ui.opened).toBe(true);
    });
  });

  describe("drawing outside a wizard callback", () => {
    it("names the chain by what the command is doing", () => {
      const ui = watched();
      ui.describe("Listing origins");
      ui.open();

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

    it("keeps it out of a command that has no summary to put it in", () => {
      const ui = watched();
      ui.ranAgainst("proj-1", "api.zitadel.cloud");
      ui.finish({ title: "Removed the origin", sections: [] });

      expect(printed()).not.toContain("Using project proj-1");
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

import { stripAnsi } from "consola/utils";
import pc from "picocolors";
import { describe, expect, it } from "vitest";

import { Ending } from "../../../../src/lib/ui/ending";
import { section, type Summary } from "../../../../src/lib/ui/summary";
import { Where } from "../../../../src/lib/ui/where";

const plain = (text: string | undefined): string => stripAnsi(text ?? "");
const nowhere = new Where();
const somewhere = new Where("proj-1", "api.zitadel.cloud");
const ending = (summary: Partial<Summary>, where = nowhere): Ending =>
  new Ending({ title: "Done", sections: [], ...summary }, where);

describe("Ending", () => {
  describe("the line it closes on", () => {
    it("is the headline the command gave", () => {
      expect(plain(ending({ title: "Removed the origin" }).line)).toBe("Removed the origin");
    });

    it("is red when the headline is a failure", () => {
      expect(ending({ title: "Stopped", failed: true }).line).toBe(pc.red("Stopped"));
    });
  });

  describe("what goes under it", () => {
    it("is nothing at all for a command that produced nothing and reached nothing", () => {
      expect(ending({}).render()).toBeUndefined();
    });

    it("says nothing at all for a command that produced nothing and left nothing to do", () => {
      expect(ending({}, somewhere).render()).toBeUndefined();
    });

    it("states the facts under the closing line, unframed, when nothing is left to do", () => {
      const below = plain(ending({ sections: [section("Project", ["Id", "proj-1"])] }).render());

      expect(below).toContain("proj-1");
      expect(below).not.toContain("╭");
    });

    it("frames the steps a command left to do", () => {
      expect(
        plain(
          ending({
            next: [{ text: "Deploy it:", command: "zitadel deploy" }],
            boxed: true,
          }).render(),
        ),
      ).toContain("zitadel deploy");
    });

    it("frames a command that asked for a box though it produced nothing", () => {
      expect(plain(ending({ boxed: true }).render())).toContain("╭");
    });

    it("closes the box with where it ran, under what the command produced", () => {
      const below = plain(
        ending(
          {
            lines: ["a table"],
            next: [{ text: "Deploy it:", command: "zitadel deploy" }],
            boxed: true,
          },
          somewhere,
        ).render(),
      );

      expect(below.indexOf("a table")).toBeLessThan(below.indexOf("Using project proj-1"));
    });

    it("leaves a listing alone: no frame, and no line about where it ran", () => {
      const below = plain(ending({ lines: ["a table"] }, somewhere).render());

      expect(below).toContain("a table");
      expect(below).not.toContain("╭");
      expect(below).not.toContain("Using project proj-1");
    });

    it("drops the blank lines a command's own rendering left at either end", () => {
      const below = plain(ending({ lines: ["", "a table", ""] }).render());

      expect(below).not.toMatch(/╮\n[^\n]*\n\s*│\s*\n/);
    });

    it("titles the box as the command asked", () => {
      expect(plain(ending({ boxed: true, boxTitle: "Zitadel is ready" }).render())).toContain(
        "Zitadel is ready",
      );
    });

    it("titles it Summary when the command did not ask for a title", () => {
      expect(plain(ending({ boxed: true }).render())).toContain("Summary");
    });
  });
});

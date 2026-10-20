import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";

import type { Asker } from "../../../../src/lib/input";
import { Wizard } from "../../../../src/lib/wizard";

type Question = Parameters<Asker>[0];

/**
 * A wizard whose asker writes the question to the stream it was given, as a
 * prompt would, and answers from a script.
 */
function wizardWith(answers: unknown[] = []): { wizard: Wizard; drawn: () => string } {
  const sink = new PassThrough();
  let drawn = "";
  sink.on("data", (chunk) => {
    drawn += chunk.toString();
  });
  const ask = (async (question: Question) => {
    question.output?.write(`◇  ${question.message}\n│  ${String(answers[0])}\n`);
    return answers.shift();
  }) as Asker;
  return { wizard: new Wizard({ ask, output: sink }), drawn: () => drawn };
}

describe("Wizard", () => {
  describe("say", () => {
    it("draws a message on the rail with a mark", () => {
      const { wizard, drawn } = wizardWith();

      wizard.say("Google needs an OAuth application.");

      expect(drawn()).toBe("│\n●  Google needs an OAuth application.\n");
    });

    it("hangs further lines under the mark", () => {
      const { wizard, drawn } = wizardWith();

      wizard.say(["First line", "second line"]);

      expect(drawn()).toBe("│\n●  First line\n│  second line\n");
    });

    it("keeps the rail through an empty line", () => {
      const { wizard, drawn } = wizardWith();

      wizard.say(["Heading", "", "after"]);

      expect(drawn()).toBe("│\n●  Heading\n│\n│  after\n");
    });
  });

  describe("table", () => {
    it("aligns columns on what is visible", () => {
      const { wizard } = wizardWith();

      const lines = wizard.table(
        ["User attribute", "Claim", "Verified"],
        [
          ["email", "email", { text: "yes, by email_verified", tone: "success" }],
          ["givenName", "given_name", { text: "no", tone: "muted" }],
        ],
      );

      expect(lines).toEqual([
        "  User attribute    Claim         Verified",
        "  email             email         yes, by email_verified",
        "  givenName         given_name    no",
      ]);
    });

    it("sits under a message's text when it is drawn with it", () => {
      const { wizard, drawn } = wizardWith();

      wizard.say(["Maps:", "", ...wizard.table(["A", "B"], [["x", "y"]])]);

      expect(drawn()).toBe("│\n●  Maps:\n│\n│    A    B\n│    x    y\n");
    });
  });

  describe("branch", () => {
    it("opens with a connector and a title", async () => {
      const { wizard, drawn } = wizardWith();

      await wizard.branch("Adding a claim", async () => undefined);

      expect(drawn()).toBe("│\n├─●  Adding a claim\n");
    });

    it("indents the questions asked inside it", async () => {
      const { wizard, drawn } = wizardWith(["corp-sso"]);

      await wizard.branch("Configuring the new provider", async () => {
        await wizard.ask({
          kind: "text",
          name: "slug",
          message: "What should this connection be called?",
          parse: (value) => ({ ok: true, value }),
        });
      });

      expect(drawn()).toBe(
        "│\n├─●  Configuring the new provider\n│  ◇  What should this connection be called?\n│  │  corp-sso\n",
      );
    });

    it("indents deeper inside a branch within a branch", async () => {
      const { wizard, drawn } = wizardWith();

      await wizard.branch("Outer", async () => {
        await wizard.branch("Inner", async () => {
          wizard.say("deep");
        });
      });

      expect(drawn()).toContain("│  │\n│  ├─●  Inner\n│  │  │\n│  │  ●  deep\n");
    });

    it("returns what its body returns", async () => {
      const { wizard } = wizardWith();

      const value = await wizard.branch("Any", async () => 42);

      expect(value).toBe(42);
    });

    it("leaves the branch even when its body throws", async () => {
      const { wizard } = wizardWith();

      await expect(
        wizard.branch("Any", async () => {
          throw new Error("cancelled");
        }),
      ).rejects.toThrow("cancelled");
      expect(wizard.depth).toBe(0);
    });

    it("counts depth by branches", async () => {
      const { wizard } = wizardWith();
      let inside = -1;

      await wizard.branch("Any", async () => {
        inside = wizard.depth;
      });

      expect(inside).toBe(1);
    });
  });

  describe("ask", () => {
    it("hands the question the stream it is drawn on", async () => {
      const seen: Question[] = [];
      const wizard = new Wizard({
        ask: (async (question: Question) => {
          seen.push(question);
          return true;
        }) as Asker,
        output: new PassThrough(),
      });

      await wizard.ask({
        kind: "confirm",
        name: "go on",
        message: "Go on?",
      });

      expect(seen[0]?.output).toBeDefined();
    });
  });

  describe("style", () => {
    it("leaves text plain when the output shows no colour", () => {
      const { wizard } = wizardWith();

      expect(wizard.style("success", "ok")).toBe("ok");
    });
  });
});

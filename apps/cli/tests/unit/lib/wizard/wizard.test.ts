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

/** What a script answers: a value, or going back. */
const BACK = Symbol("back");

/**
 * A wizard over a script. A script entry of BACK is the person going back: for
 * a select it picks the "Go back" option, for text it types `<`. Everything the
 * wizard asked is kept, as it was drawn.
 */
function scriptedWizard(script: unknown[]): { wizard: Wizard; asked: Question[] } {
  const asked: Question[] = [];
  const ask = (async (question: Question) => {
    asked.push(question);
    const next = script.shift();
    if (question.kind === "select") {
      if (next === BACK) {
        return question.options.find((option) => option.label === "Go back")?.value;
      }
      return next;
    }
    if (question.kind === "text" || question.kind === "secret") {
      const parsed = question.parse(next === BACK ? "<" : String(next));
      if (!parsed.ok) {
        throw new Error(parsed.problem);
      }
      return parsed.value;
    }
    return next;
  }) as Asker;
  return { wizard: new Wizard({ ask, output: new PassThrough() }), asked };
}

const text = (name: string, message = name): Question => ({
  kind: "text",
  name,
  message,
  parse: (value) => ({ ok: true, value }),
});

const choice = (name: string): Question => ({
  kind: "select",
  name,
  message: name,
  options: [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
  ],
});

describe("Wizard.steps", () => {
  it("runs the steps in order and returns the state they build", async () => {
    const { wizard } = scriptedWizard(["one", "two"]);

    const state = await wizard.steps<Record<string, string>>({}, [
      async (s) => ({ ...s, first: (await wizard.ask(text("first"))) as string }),
      async (s) => ({ ...s, second: (await wizard.ask(text("second"))) as string }),
    ]);

    expect(state).toEqual({ first: "one", second: "two" });
  });

  it("goes back to the previous step and re-runs it with the state it started from", async () => {
    const { wizard, asked } = scriptedWizard(["one", BACK, "uno", "two"]);
    const seen: Record<string, string>[] = [];

    const state = await wizard.steps<Record<string, string>>({}, [
      async (s) => {
        seen.push(s);
        return { ...s, first: (await wizard.ask(text("first"))) as string };
      },
      async (s) => ({ ...s, second: (await wizard.ask(text("second"))) as string }),
    ]);

    expect(state).toEqual({ first: "uno", second: "two" });
    expect(seen).toEqual([{}, {}]);
    expect(asked.map((one) => one.name)).toEqual(["first", "second", "first", "second"]);
  });

  it("offers no way back from the first step", async () => {
    const { wizard, asked } = scriptedWizard(["one"]);

    await wizard.steps({}, [async (s) => ({ ...s, v: await wizard.ask(choice("pick")) })]);

    const first = asked[0];
    expect(first?.kind === "select" ? first.options.map((one) => one.label) : []).toEqual([
      "A",
      "B",
    ]);
  });

  it("offers a Go back option on a select once there is somewhere to go back to", async () => {
    const { wizard, asked } = scriptedWizard(["x", "a"]);

    await wizard.steps({}, [
      async (s) => ({ ...s, one: await wizard.ask(text("one")) }),
      async (s) => ({ ...s, two: await wizard.ask(choice("two")) }),
    ]);

    const second = asked[1];
    expect(second?.kind === "select" ? second.options.map((one) => one.label) : []).toEqual([
      "A",
      "B",
      "Go back",
    ]);
  });

  it("lets a text question take < to go back, and says so", async () => {
    const { wizard, asked } = scriptedWizard(["x", "y"]);

    await wizard.steps({}, [
      async (s) => ({ ...s, one: await wizard.ask(text("one")) }),
      async (s) => ({ ...s, two: await wizard.ask(text("two", "Second?")) }),
    ]);

    expect(asked[1]?.message).toContain("Second?");
    expect(asked[1]?.message).toContain("< goes back");
  });

  it("goes back from a text question when < is typed", async () => {
    const { wizard, asked } = scriptedWizard(["x", BACK, "x2", "y"]);

    const state = await wizard.steps<Record<string, unknown>>({}, [
      async (s) => ({ ...s, one: await wizard.ask(text("one")) }),
      async (s) => ({ ...s, two: await wizard.ask(text("two")) }),
    ]);

    expect(state).toEqual({ one: "x2", two: "y" });
    expect(asked.map((one) => one.name)).toEqual(["one", "two", "one", "two"]);
  });

  it("skips a step that asked nothing when going back", async () => {
    const { wizard, asked } = scriptedWizard(["x", BACK, "x2", "y2"]);

    await wizard.steps({}, [
      async (s) => ({ ...s, one: await wizard.ask(text("one")) }),
      async (s) => s,
      async (s) => ({ ...s, three: await wizard.ask(text("three")) }),
    ]);

    expect(asked.map((one) => one.name)).toEqual(["one", "three", "one", "three"]);
  });

  it("shows an earlier answer again when its question is re-asked", async () => {
    const { wizard, asked } = scriptedWizard(["x", BACK, "x2", "y"]);

    await wizard.steps({}, [
      async (s) => ({ ...s, one: await wizard.ask(text("one")) }),
      async (s) => ({ ...s, two: await wizard.ask(text("two")) }),
    ]);

    const again = asked[2];
    expect(again?.kind === "text" ? again.initialValue : undefined).toBe("x");
  });

  it("never shows a secret again", async () => {
    const { wizard, asked } = scriptedWizard(["x", BACK, "x2", "hunter3"]);
    const secret = (): Question => ({
      kind: "secret",
      name: "secret",
      message: "Secret",
      parse: (value) => ({ ok: true, value }),
    });

    await wizard.steps({}, [
      async (s) => ({ ...s, one: await wizard.ask(text("one")) }),
      async (s) => ({ ...s, secret: await wizard.ask(secret()) }),
    ]);

    const again = asked[3];
    expect(
      again?.kind === "secret" ? (again as { initialValue?: string }).initialValue : "x",
    ).toBeUndefined();
  });

  it("does not offer a way back from a question a flag already answered", async () => {
    const { wizard, asked } = scriptedWizard(["x"]);
    const given: Question = { ...text("two"), given: "from-flag" } as Question;

    await wizard.steps({}, [
      async (s) => ({ ...s, one: await wizard.ask(text("one")) }),
      async (s) => ({ ...s, two: await wizard.ask(given) }),
    ]);

    expect(asked[1]?.message).toBe("two");
  });

  it("passes a back from the first step to the run around it", async () => {
    const { wizard, asked } = scriptedWizard(["o", BACK, "o2", "i2"]);

    const state = await wizard.steps<Record<string, unknown>>({}, [
      async (s) => ({ ...s, outer: await wizard.ask(text("outer")) }),
      async (s) => ({
        ...s,
        inner: await wizard.steps<Record<string, unknown>>({}, [
          async (t) => ({ ...t, inner: await wizard.ask(text("inner")) }),
        ]),
      }),
    ]);

    expect(state.outer).toBe("o2");
    expect(asked.map((one) => one.name)).toEqual(["outer", "inner", "outer", "inner"]);
  });

  it("says it is going back", async () => {
    const sink = new PassThrough();
    let drawn = "";
    sink.on("data", (chunk) => {
      drawn += chunk.toString();
    });
    const script: unknown[] = ["x", BACK, "x2", "y"];
    const wizard = new Wizard({
      ask: (async (question: Question) => {
        const next = script.shift();
        const parsed =
          question.kind === "text" ? question.parse(next === BACK ? "<" : String(next)) : undefined;
        return parsed?.ok ? parsed.value : undefined;
      }) as Asker,
      output: sink,
    });

    await wizard.steps({}, [
      async (s) => ({ ...s, one: await wizard.ask(text("one")) }),
      async (s) => ({ ...s, two: await wizard.ask(text("two")) }),
    ]);

    expect(drawn).toContain("Going back.");
  });
});

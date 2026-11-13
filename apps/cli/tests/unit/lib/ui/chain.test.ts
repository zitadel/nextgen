import { stripVTControlCharacters as stripAnsi } from "node:util";
import { afterEach, describe, expect, vi } from "vitest";

import { PromptCancelled, ZitadelError } from "@/lib/errors";
import { Chain } from "@/lib/ui/chain";
import { DrawnSpinner } from "@/lib/ui/spinner";
import { GUIDE, MARK } from "@/lib/ui/marks";
import { atScreen as it } from "@tests/helpers/fixtures";
import { answering, type Person, type Terminal } from "@tests/helpers/keyboard";
import { asTerminal } from "@tests/helpers/terminal";

const watching = () => new Chain({ interactive: true, force: false });
const normally = () => new Chain({ interactive: true, force: false }, "plain");
const scripted = () => new Chain({ interactive: false, force: false });

/** How long clack waits between one frame of a spinner and the next. */
const FRAME = 100;

afterEach(() => {
  vi.useRealTimers();
  DrawnSpinner.active.clear();
});

const printed = (screen: Terminal) => stripAnsi(screen.plain());

describe("Chain", () => {
  it("draws nothing at all when nobody is watching", ({ screen }) => {
    const chain = scripted();
    chain.describe("Listing origins");
    chain.finish({ title: "Found 1 origin", sections: [] });

    expect(printed(screen)).toBe("");
  });

  // The gutter is the only part of a narrated line that needs a terminal, so
  // a run nobody is watching is told the same thing with the same mark. Said
  // through `consola` instead, a warning arrived as its ` WARN ` badge and a
  // step as a glyph of consola's choosing, which is the chain's marks in name
  // only.
  it("writes a wizard's narration, with the mark it would have drawn", ({ screen }) => {
    scripted().narrate("i", "the flow was edited by hand");

    expect(printed(screen)).toBe("i  the flow was edited by hand\n");
  });

  it.for([
    ["a warning", MARK.warning],
    ["a failure", MARK.failed],
  ] as const)(
    "writes %s to stderr, where a normal command puts it",
    ([_kind, mark], { screen }) => {
      scripted().narrate(mark, "the flow was edited by hand");

      expect(printed(screen)).toBe("");
      expect(stripAnsi(screen.errors())).toContain("the flow was edited by hand");
    },
  );

  // `│` is what a line that carries no mark of its own is given, and off a
  // terminal a lone gutter is a stray glyph: the line is indented to the same
  // column instead, so the marks above and below it still line up.
  it("writes a line that carries no mark as an indent, not as a gutter", ({ screen }) => {
    scripted().narrate(GUIDE, "and this is why");

    expect(printed(screen)).toBe("   and this is why\n");
  });

  it("writes a blank line as a gap, with no mark", ({ screen }) => {
    scripted().narrate("i", "");

    expect(printed(screen)).toBe("\n");
  });

  // Narration used to reach clack whenever the chain was not plain-and-watched,
  // so a run nobody was watching put a `│` on stdout — clack draws the gutter
  // whether or not anything opened it.
  it.for([
    ["a wizard", () => new Chain({ interactive: false, force: false })],
    ["a normal command", () => new Chain({ interactive: false, force: false }, "plain")],
  ] as const)("draws no gutter for %s nobody is watching", ([_shape, make], { screen }) => {
    make().narrate("i", "something happened");

    expect(printed(screen)).not.toContain("│");
  });

  it("opens on the first thing drawn, not when it is named", ({ screen }) => {
    const chain = watching();
    chain.describe("Listing origins");

    expect(printed(screen)).toBe("");

    chain.narrate("i", "first line");

    expect(printed(screen)).toContain("┌  Listing origins");
  });

  it("closes once, however many times it is asked to", ({ screen }) => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.narrate("i", "asked something");
    chain.finish({ title: "Found 1 origin", sections: [] });
    chain.finish({ title: "Found 2 origins", sections: [] });

    expect(printed(screen).split("└").length - 1).toBe(1);
    expect(printed(screen)).toContain("└  Found 1 origin");
  });

  it("prints a listing as it is, with no frame around it", ({ screen }) => {
    const chain = watching();
    chain.describe("Listing origins");
    chain.finish({ title: "Found 1 origin", sections: [], lines: ["pattern  kind"] });

    expect(printed(screen)).toContain("pattern  kind");
    expect(printed(screen)).not.toContain("╭");
  });

  it("names where it ran in the footer's words for a normal command", ({ screen }) => {
    const chain = normally();
    chain.describe("Removing an origin");
    chain.ranAgainst("proj-1", "api.zitadel.cloud");
    chain.finish({ title: "Removed the origin", sections: [] });

    expect(printed(screen)).toContain("Removed the origin · project proj-1 on api.zitadel.cloud");
    expect(printed(screen)).not.toContain("╭");
  });

  it("says where it ran as the last line of a summary it does have", ({ screen }) => {
    const chain = watching();
    chain.describe("Deploying the configuration");
    chain.ranAgainst("proj-1", "api.zitadel.cloud");
    chain.finish({
      title: "Deployed it",
      sections: [],
      lines: ["a detail"],
      next: [{ text: "Check it:", command: "zitadel status" }],
      boxed: true,
    });

    const box = printed(screen);
    expect(box).toContain("╭");
    expect(box.indexOf("a detail")).toBeLessThan(box.indexOf("Using project proj-1"));
  });

  it("wraps a note so a box never outgrows the width everything obeys", ({ screen }) => {
    const chain = watching();
    chain.describe("Enabling single sign-on");
    chain.note("Register an app", ["x ".repeat(120).trim()]);

    const widest = Math.max(
      ...printed(screen)
        .split("\n")
        .filter((line) => line.includes("x x"))
        .map((line) => {
          return line.replace(/^│ {2}/, "").replace(/\s*│$/, "").length;
        }),
    );
    expect(printed(screen).split("Register an app").length - 1).toBe(1);
    expect(widest).toBeLessThanOrEqual(72);
  });

  // The base command renders a failure as an error block through `finish`, so
  // closing the chain on the failure itself would make that call return early
  // and the run would end showing nothing but its closing line.
  it("leaves a failure for the error block to close", ({ screen }) => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.narrate("i", "asked");

    chain.abort(new Error("boom"));
    chain.finish({ title: "Could not remove the origin", sections: [] });

    expect(printed(screen).split("└").length - 1).toBe(1);
    expect(printed(screen)).toContain("└  Could not remove the origin");
  });

  it("stays quiet when the person cancelled, because the prompt already said so", ({ screen }) => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.narrate("i", "asked");

    chain.abort(new PromptCancelled());

    expect(printed(screen)).not.toContain("└");
  });

  it("closes the chain for a cancellation that was not a prompt's, whatever it says", ({
    screen,
  }) => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.narrate("i", "asked");

    chain.abort(new ZitadelError("E_CANCELLED", "Cancelled by user"));

    expect(printed(screen)).toContain("└");
  });

  // Ctrl-C in the middle of the work closes nothing by itself, so without
  // this the run ends on a bare `┌` and the shell prompt lands in the gutter.
  it("closes the chain when the person interrupted the work", ({ screen }) => {
    const chain = watching();
    chain.describe("Listing variables");
    chain.narrate("!", "a warning");

    chain.abort(new ZitadelError("E_CANCELLED", "Cancelled"));

    expect(printed(screen)).toMatch(/└ +Cancelled/);
  });

  it("closes nothing when the interrupt arrived before anything was drawn", ({ screen }) => {
    const chain = watching();
    chain.describe("Listing variables");

    chain.abort(new ZitadelError("E_CANCELLED", "Cancelled"));

    expect(printed(screen)).not.toContain("└");
  });

  it("closes on the one cancellation sentence, which claims nothing about what changed", ({
    screen,
  }) => {
    const chain = watching();
    chain.describe("Listing variables");
    chain.narrate("!", "a warning");

    chain.abort(new ZitadelError("E_CANCELLED", "Cancelled"));

    expect(printed(screen).split("└").at(-1)?.trim()).toBe("Cancelled");
  });

  it("leaves a bridged line that already fits on one line", ({ screen }) => {
    const chain = watching();
    chain.describe("Listing variables");

    chain.narrate("!", "a short warning");

    expect(
      printed(screen)
        .split("\n")
        .filter((line) => line.includes("a short warning")),
    ).toHaveLength(1);
  });
});

// The defect this presentation fixes: the shape used to be decided at the end
// of the run by asking whether anything had opened the chain, so a question or
// a warning turned a normal command into a wizard and `--force` turned it back.
describe("a normal command's chain, which is no chain at all", () => {
  const removing = (chain: Chain) => {
    chain.describe("Removing a variable");
    chain.ranAgainst("proj-1", "localhost:8111");
  };
  const removed = { title: "Removed B from the project", sections: [] };

  it("opens nothing, whatever the command said on the way", ({ screen }) => {
    const chain = normally();
    removing(chain);
    chain.say("the project is in development");
    chain.finish(removed);

    expect(printed(screen)).not.toContain("┌");
    expect(printed(screen)).not.toContain("└");
  });

  it("ends on its answer and one footer line", ({ screen }) => {
    const chain = normally();
    removing(chain);
    chain.finish(removed);

    expect(printed(screen)).toBe("Removed B from the project · project proj-1 on localhost:8111\n");
  });

  it("never frames a summary that asked for a box", ({ screen }) => {
    const chain = normally();
    removing(chain);
    chain.finish({
      ...removed,
      boxed: true,
      next: [{ text: "Deploy it:", command: "zitadel deploy" }],
    });

    expect(printed(screen)).not.toContain("╭");
  });

  it("says a failure with no chain to close", ({ screen }) => {
    const chain = normally();
    removing(chain);
    chain.finish({ title: "Error: No such variable (E_NOT_FOUND)", sections: [], failed: true });

    expect(printed(screen)).not.toContain("└");
    expect(printed(screen)).toContain("Error: No such variable (E_NOT_FOUND)");
  });

  it("keeps a spinner out of the gutter it does not have", ({ screen }) => {
    normally().spinner("Fetching users");

    expect(printed(screen)).not.toContain("┌");
    expect(printed(screen)).not.toContain("│");
  });

  /**
   * Everything drawn, in order, with the frames of a spinner running under
   * `label` where they fell, which is how a person sees it clear and come back.
   */
  const aSpinnerRunning = (chain: Chain, label: string) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const running = chain.spinner(label);
    vi.advanceTimersByTime(FRAME);
    return running;
  };

  it("clears a running spinner before it narrates a line and draws it again after", ({
    screen,
  }) => {
    const chain = watching();
    const running = aSpinnerRunning(chain, "Deploying");

    chain.narrate("i", "halfway there");
    vi.advanceTimersByTime(FRAME);

    const shown = printed(screen);
    expect(shown.indexOf("Deploying")).toBeLessThan(shown.indexOf("halfway there"));
    expect(shown.lastIndexOf("Deploying")).toBeGreaterThan(shown.indexOf("halfway there"));
    running.clear();
  });

  it("clears a running spinner before it draws a note and draws it again after", ({ screen }) => {
    const chain = watching();
    const running = aSpinnerRunning(chain, "Deploying");

    chain.note("Register an app", ["open the console"]);
    vi.advanceTimersByTime(FRAME);

    const shown = printed(screen);
    expect(shown.indexOf("Deploying")).toBeLessThan(shown.indexOf("Register an app"));
    expect(shown.lastIndexOf("Deploying")).toBeGreaterThan(shown.indexOf("Register an app"));
    running.clear();
  });

  it("clears a running spinner before a question is drawn and draws it again after the answer", async () => {
    const person = answering(true);
    const chain = watching();
    const running = aSpinnerRunning(chain, "Deploying");

    await asTerminal(() => {
      return chain.questions().yesNo({ name: "deploy it", message: "Deploy it now?" });
    });
    vi.advanceTimersByTime(FRAME);

    const shown = printed(person);
    expect(shown.indexOf("Deploying")).toBeLessThan(shown.indexOf("Deploy it now?"));
    expect(shown.lastIndexOf("Deploying")).toBeGreaterThan(shown.lastIndexOf("Deploy it now?"));
    running.clear();
  });

  it.each([
    ["plain", normally],
    ["wizard", watching],
  ] as const)(
    "draws a running spinner again when the question is walked away from in a %s chain",
    async (_shape, make) => {
      const person = answering(undefined);
      const chain = make();
      const running = aSpinnerRunning(chain, "Deploying");

      await expect(
        asTerminal(() => {
          return chain.questions().yesNo({ name: "deploy it", message: "Deploy it now?" });
        }),
      ).rejects.toMatchObject({ code: "E_CANCELLED" });
      vi.advanceTimersByTime(FRAME);

      const shown = printed(person);
      expect(shown.indexOf("Deploying")).toBeLessThan(shown.indexOf("Deploy it now?"));
      expect(shown.lastIndexOf("Deploying")).toBeGreaterThan(shown.lastIndexOf("Deploy it now?"));
      running.clear();
    },
  );

  it("clears a spinner still running when the run is cancelled, before Cancelled is said", () => {
    const chain = watching();
    chain.spinner("Deploying");

    chain.abort(new ZitadelError("E_CANCELLED", "Cancelled"));

    expect(DrawnSpinner.active.size).toBe(0);
  });

  // `task` and `begin` got the gutter that `spinner` was taught to keep out
  // of, so a normal command that reported a step drew a `│` above its answer.
  it("keeps a step out of the gutter it does not have", async ({ screen }) => {
    await normally().task("Fetching variables", async () => undefined);

    expect(printed(screen)).not.toContain("┌");
    expect(printed(screen)).not.toContain("│");
  });

  it("keeps a hand-ended step out of it too", ({ screen }) => {
    normally().begin("Fetching variables").done();

    expect(printed(screen)).not.toContain("│");
  });

  // Ctrl-C at a plain prompt left the line it was typing on, with nothing but
  // the terminal's own `^C`, so the shell prompt continued that line. The same
  // sentence a wizard closes on says the run stopped.
  it("says the one cancellation sentence where there is no chain to close", ({ screen }) => {
    const chain = normally();
    removing(chain);

    chain.abort(new ZitadelError("E_CANCELLED", "Cancelled by user"));

    expect(printed(screen)).toBe("\nCancelled\n");
  });

  // `--force` is a flag about whether to ask. The only difference it may make
  // to what a person sees is that the question is absent.
  it("looks the same forced as it does answering, but for the question", async () => {
    const run = (force: boolean, person: Person) => async () => {
      const chain = new Chain({ interactive: true, force }, "plain");
      removing(chain);
      await chain.questions().confirm({
        name: "remove the variable",
        message: "Remove B from the project?",
      });
      const before = person.plain().length;
      chain.finish(removed);
      return stripAnsi(person.plain().slice(before));
    };

    const forcing = answering();
    const forced = await asTerminal(run(true, forcing));
    const answerer = answering(true);
    const answered = await asTerminal(run(false, answerer));

    expect(forced).toBe("Removed B from the project · project proj-1 on localhost:8111\n");
    expect(answered).toBe(forced);
    expect(forcing.asked()).toEqual([]);
    expect(answerer.asked()).toEqual(["Remove B from the project?"]);
  });

  it("asks its questions without the guide a wizard draws", async () => {
    const person = answering(true);

    await asTerminal(() =>
      normally().questions().confirm({
        name: "remove the variable",
        message: "Remove B from the project?",
      }),
    );

    expect(person.asked()).toEqual(["Remove B from the project?"]);
    expect(stripAnsi(person.plain())).not.toContain("│");
  });

  it("asks a wizard's questions with the guide", async () => {
    const person = answering(true);

    await asTerminal(() =>
      watching().questions().confirm({
        name: "remove the variable",
        message: "Remove B from the project?",
      }),
    );

    expect(stripAnsi(person.plain())).toContain("│");
  });

  // A run nothing can be drawn into used to fall through to a third rendering
  // that was neither shape: `(server: host)` at the
  // top for the place at the end, and no box at all. The words are the
  // command's, so they are the same written as drawn.
  describe("the ending written out, for a run nothing is drawn into", () => {
    const summary = {
      title: "Checked the status of the project",
      sections: [],
      lines: ["Project proj-1, lifecycle configured"],
      next: [{ text: "Next:", command: "npx @zitadel/cli@0.1.0 start" }],
      boxed: true,
    };

    it("says the line a wizard would have closed on", () => {
      const chain = scripted();
      chain.ranAgainst("proj-1", "localhost:8111");

      expect(stripAnsi(chain.written(summary))).toContain("Checked the status of the project");
    });

    it("introduces a command under the label every box uses", () => {
      const text = stripAnsi(scripted().written(summary));

      expect(text).toContain("Next:");
    });

    it("ends a wizard on where it ran, in the sentence the box ends on", () => {
      const chain = scripted();
      chain.ranAgainst("proj-1", "localhost:8111");

      expect(stripAnsi(chain.written(summary))).toContain(
        "Using project proj-1 on your local Zitadel server at localhost:8111.",
      );
    });

    it("ends a normal command on its answer and the one footer", () => {
      const chain = new Chain({ interactive: false, force: false }, "plain");
      chain.ranAgainst("proj-1", "localhost:8111");

      expect(stripAnsi(chain.written(removed))).toBe(
        "Removed B from the project · project proj-1 on localhost:8111\n",
      );
    });

    it("writes nothing of its own: the caller decides where it goes", ({ screen }) => {
      scripted().written(summary);

      expect(printed(screen)).toBe("");
    });
  });
});

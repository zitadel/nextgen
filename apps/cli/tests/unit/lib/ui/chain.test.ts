import { stripAnsi } from "consola/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { intro, log, note, outro, spinner } from "@clack/prompts";

import { ZitadelError } from "../../../../src/lib/errors";
import { Chain } from "../../../../src/lib/ui/chain";
import { GUIDE } from "../../../../src/lib/ui/marks";
import { asTerminalTyping } from "../../../helpers/terminal";

const watching = () => new Chain({ interactive: true, force: false });
const normally = () => new Chain({ interactive: true, force: false }, "plain");
const scripted = () => new Chain({ interactive: false, force: false });

let written: string[] = [];

beforeEach(() => {
  written = [];
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

describe("Chain", () => {
  it("draws nothing at all when nobody is watching", () => {
    const chain = scripted();
    chain.describe("Listing origins");
    chain.finish({ title: "Found 1 origin", sections: [] });

    expect(intro).not.toHaveBeenCalled();
    expect(outro).not.toHaveBeenCalled();
    expect(printed()).toBe("");
  });

  // The gutter is the only part of a narrated line that needs a terminal, so
  // a run nobody is watching is told the same thing with the same mark. Said
  // through `consola` instead, a warning arrived as its ` WARN ` badge and a
  // step as a glyph of consola's choosing, which is the chain's marks in name
  // only.
  it("writes a wizard's narration, with the mark it would have drawn", () => {
    scripted().narrate("!", "the flow was edited by hand");

    expect(printed()).toBe("!  the flow was edited by hand\n");
  });

  // `│` is what a line that carries no mark of its own is given, and off a
  // terminal a lone gutter is a stray glyph: the line is indented to the same
  // column instead, so the marks above and below it still line up.
  it("writes a line that carries no mark as an indent, not as a gutter", () => {
    scripted().narrate(GUIDE, "and this is why");

    expect(printed()).toBe("   and this is why\n");
  });

  // Narration used to reach clack whenever the chain was not plain-and-watched,
  // so a run nobody was watching put a `│` on stdout — clack draws the gutter
  // whether or not anything opened it.
  it.each([
    ["a wizard", () => new Chain({ interactive: false, force: false })],
    ["a normal command", () => new Chain({ interactive: false, force: false }, "plain")],
  ])("draws no gutter for %s nobody is watching", (_shape, make) => {
    make().narrate("i", "something happened");

    expect(log.message).not.toHaveBeenCalled();
  });

  it("opens on the first thing drawn, not when it is named", () => {
    const chain = watching();
    chain.describe("Listing origins");

    expect(intro).not.toHaveBeenCalled();

    chain.narrate("i", "first line");

    expect(intro).toHaveBeenCalledWith("Listing origins");
  });

  it("closes once, however many times it is asked to", () => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.narrate("i", "asked something");
    chain.finish({ title: "Found 1 origin", sections: [] });
    chain.finish({ title: "Found 2 origins", sections: [] });

    expect(outro).toHaveBeenCalledTimes(1);
    expect(outro).toHaveBeenCalledWith("Found 1 origin");
  });

  it("prints a listing as it is, with no frame around it", () => {
    const chain = watching();
    chain.describe("Listing origins");
    chain.finish({ title: "Found 1 origin", sections: [], lines: ["pattern  kind"] });

    expect(printed()).toContain("pattern  kind");
    expect(printed()).not.toContain("╭");
  });

  it("names where it ran in the footer's words for a normal command", () => {
    const chain = normally();
    chain.describe("Removing an origin");
    chain.ranAgainst("proj-1", "api.zitadel.cloud");
    chain.finish({ title: "Removed the origin", sections: [] });

    expect(printed()).toContain("Removed the origin · project proj-1 on api.zitadel.cloud");
    expect(printed()).not.toContain("╭");
  });

  it("says where it ran as the last line of a summary it does have", () => {
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

    const box = printed();
    expect(box).toContain("╭");
    expect(box.indexOf("a detail")).toBeLessThan(box.indexOf("Using project proj-1"));
  });

  it("wraps a note so a box never outgrows the width everything obeys", () => {
    const chain = watching();
    chain.describe("Enabling single sign-on");
    chain.note("Register an app", ["x ".repeat(120).trim()]);

    expect(note).toHaveBeenCalledOnce();
    const [body] = vi.mocked(note).mock.calls[0] ?? [""];
    expect(
      Math.max(
        ...String(body)
          .split("\n")
          .map((line) => line.length),
      ),
    ).toBeLessThanOrEqual(72);
  });

  // The base command renders a failure as an error block through `finish`, so
  // closing the chain on the failure itself would make that call return early
  // and the run would end showing nothing but its closing line.
  it("leaves a failure for the error block to close", () => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.narrate("i", "asked");

    chain.abort(new Error("boom"));
    chain.finish({ title: "Could not remove the origin", sections: [] });

    expect(outro).toHaveBeenCalledOnce();
    expect(outro).toHaveBeenCalledWith("Could not remove the origin");
  });

  it("stays quiet when the person cancelled, because the prompt already said so", () => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.narrate("i", "asked");

    chain.abort(new ZitadelError("E_CANCELLED", "Cancelled by user"));

    expect(outro).not.toHaveBeenCalled();
  });

  // Ctrl-C in the middle of the work closes nothing by itself, so without
  // this the run ends on a bare `┌` and the shell prompt lands in the gutter.
  it("closes the chain when the person interrupted the work", () => {
    const chain = watching();
    chain.describe("Listing variables");
    chain.narrate("!", "a warning");

    chain.abort(new ZitadelError("E_CANCELLED", "Cancelled"));

    expect(outro).toHaveBeenCalledWith(expect.stringContaining("Cancelled"));
  });

  it("closes nothing when the interrupt arrived before anything was drawn", () => {
    const chain = watching();
    chain.describe("Listing variables");

    chain.abort(new ZitadelError("E_CANCELLED", "Cancelled"));

    expect(outro).not.toHaveBeenCalled();
  });

  it("closes on the one cancellation sentence, which claims nothing about what changed", () => {
    const chain = watching();
    chain.describe("Listing variables");
    chain.narrate("!", "a warning");

    chain.abort(new ZitadelError("E_CANCELLED", "Cancelled"));

    expect(stripAnsi(String(vi.mocked(outro).mock.calls[0]?.[0]))).toBe("Cancelled");
  });

  // Read off `log.message`, not stdout: the clack double writes nothing, so
  // asserting on what was written passes however wide the line is.
  it("wraps a bridged line, which obeys no width of its own", () => {
    const chain = watching();
    chain.describe("Listing variables");

    chain.narrate("!", `a warning ${"that keeps going ".repeat(12)}`);

    expect(log.message).toHaveBeenCalledOnce();
    const [drawn] = vi.mocked(log.message).mock.calls[0] ?? [""];
    expect(
      Math.max(
        ...String(drawn)
          .split("\n")
          .map((line) => line.length),
      ),
    ).toBeLessThanOrEqual(80 - 3);
  });

  it("leaves a bridged line that already fits on one line", () => {
    const chain = watching();
    chain.describe("Listing variables");

    chain.narrate("!", "a short warning");

    expect(vi.mocked(log.message).mock.calls[0]?.[0]).toBe("a short warning");
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

  it("opens nothing, whatever the command said on the way", () => {
    const chain = normally();
    removing(chain);
    chain.say("the project is in development");
    chain.finish(removed);

    expect(intro).not.toHaveBeenCalled();
    expect(outro).not.toHaveBeenCalled();
  });

  it("ends on its answer and one footer line", () => {
    const chain = normally();
    removing(chain);
    chain.finish(removed);

    expect(printed()).toBe("Removed B from the project · project proj-1 on localhost:8111\n");
  });

  it("never frames a summary that asked for a box", () => {
    const chain = normally();
    removing(chain);
    chain.finish({
      ...removed,
      boxed: true,
      next: [{ text: "Deploy it:", command: "zitadel deploy" }],
    });

    expect(printed()).not.toContain("╭");
  });

  it("says a failure with no chain to close", () => {
    const chain = normally();
    removing(chain);
    chain.finish({ title: "Error E_NOT_FOUND: no such variable", sections: [], failed: true });

    expect(outro).not.toHaveBeenCalled();
    expect(printed()).toContain("Error E_NOT_FOUND: no such variable");
  });

  it("keeps a spinner out of the gutter it does not have", () => {
    normally().spinner("Fetching users");

    expect(intro).not.toHaveBeenCalled();
    expect(spinner).toHaveBeenCalledWith({ withGuide: false });
  });

  // `task` and `begin` got the gutter that `spinner` was taught to keep out
  // of, so a normal command that reported a step drew a `│` above its answer.
  it("keeps a step out of the gutter it does not have", async () => {
    await normally().task("Fetching variables", async () => undefined);

    expect(intro).not.toHaveBeenCalled();
    expect(log.message).not.toHaveBeenCalled();
  });

  it("keeps a hand-ended step out of it too", () => {
    normally().begin("Fetching variables").done();

    expect(log.message).not.toHaveBeenCalled();
  });

  // Ctrl-C at a plain prompt left the line it was typing on, with nothing but
  // the terminal's own `^C`, so the shell prompt continued that line. The same
  // sentence a wizard closes on says the run stopped.
  it("says the one cancellation sentence where there is no chain to close", () => {
    const chain = normally();
    removing(chain);

    chain.abort(new ZitadelError("E_CANCELLED", "Cancelled by user"));

    expect(printed()).toBe("\nCancelled\n");
  });

  // `--force` is a flag about whether to ask. The only difference it may make
  // to what a person sees is that the question is absent.
  it("looks the same forced as it does answering, but for the question", async () => {
    const run = (force: boolean) => async () => {
      const chain = new Chain({ interactive: true, force }, "plain");
      removing(chain);
      await chain.questions(true).confirm({
        name: "remove the variable",
        message: "Remove B from the project?",
      });
      chain.finish(removed);
    };

    const forced = await asTerminalTyping([], run(true));
    const answered = await asTerminalTyping(["y"], run(false));

    expect(stripAnsi(forced.shown)).toBe(
      "Removed B from the project · project proj-1 on localhost:8111\n",
    );
    expect(stripAnsi(answered.shown)).toBe(
      `Remove B from the project? [y/N] ${stripAnsi(forced.shown)}`,
    );
  });

  // A run nothing can be drawn into used to fall through to a third rendering
  // that was neither shape: `Next:` for `Run next:`, `(server: host)` at the
  // top for the place at the end, and no box at all. The words are the
  // command's, so they are the same written as drawn.
  describe("the ending written out, for a run nothing is drawn into", () => {
    const summary = {
      title: "Checked the status of the project",
      sections: [],
      lines: ["Project proj-1, lifecycle configured"],
      next: [{ text: "Run next:", command: "npx @zitadel/cli@0.1.0 start" }],
      boxed: true,
    };

    it("says the line a wizard would have closed on", () => {
      const chain = scripted();
      chain.ranAgainst("proj-1", "localhost:8111");

      expect(stripAnsi(chain.written(summary))).toContain("Checked the status of the project");
    });

    it("introduces a command under the label every box uses", () => {
      const text = stripAnsi(scripted().written(summary));

      expect(text).toContain("Run next:");
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

    it("writes nothing of its own: the caller decides where it goes", () => {
      scripted().written(summary);

      expect(printed()).toBe("");
    });
  });
});

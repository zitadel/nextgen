import { stripAnsi } from "consola/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { intro, log, note, outro } from "@clack/prompts";

import { ZitadelError } from "../../../../src/lib/errors";
import { Chain } from "../../../../src/lib/ui/chain";

const watching = () => new Chain({ interactive: true, force: false });
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
    chain.narrate("i", "something happened");
    chain.finish({ title: "Found 1 origin", sections: [] });

    expect(intro).not.toHaveBeenCalled();
    expect(outro).not.toHaveBeenCalled();
    expect(printed()).toBe("");
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

  it("names where it ran in the footer's words when it drew no box", () => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.ranAgainst("proj-1", "api.zitadel.cloud");
    chain.finish({ title: "Removed the origin", sections: [] });

    expect(printed()).toContain("Removed the origin · project proj-1 on api.zitadel.cloud");
    expect(printed()).not.toContain("Using");
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

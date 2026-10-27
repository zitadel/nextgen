import { stripAnsi } from "consola/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { intro, note, outro } from "@clack/prompts";

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

  it("keeps where it ran out of a command that has no summary to put it in", () => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.ranAgainst("proj-1", "api.zitadel.cloud");
    chain.finish({ title: "Removed the origin", sections: [] });

    expect(printed()).not.toContain("Using project proj-1");
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

    const [body] = vi.mocked(note).mock.calls[0] ?? [];
    expect(
      Math.max(
        ...String(body)
          .split("\n")
          .map((line) => line.length),
      ),
    ).toBeLessThanOrEqual(72);
  });

  it("says a run stopped when it failed partway", () => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.narrate("i", "asked");

    chain.abort(new Error("boom"));

    expect(outro).toHaveBeenCalledWith(expect.stringContaining("Stopped"));
  });

  it("stays quiet when the person cancelled, because the prompt already said so", () => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.narrate("i", "asked");

    chain.abort(new ZitadelError("E_VALIDATION", "Cancelled by user"));

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

  it("wraps a bridged line, which obeys no width of its own", () => {
    const chain = watching();
    chain.describe("Listing variables");

    chain.narrate("!", `a warning ${"that keeps going ".repeat(12)}`);

    expect(
      Math.max(
        ...printed()
          .split("\n")
          .map((line) => line.length),
      ),
    ).toBeLessThanOrEqual(80);
  });
});

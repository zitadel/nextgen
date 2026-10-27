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
    chain.describe("Listing origins");
    chain.finish({ title: "Found 1 origin", sections: [] });
    chain.finish({ title: "Found 2 origins", sections: [] });

    expect(outro).toHaveBeenCalledTimes(1);
    expect(outro).toHaveBeenCalledWith("Found 1 origin");
  });

  it("frames what the command produced", () => {
    const chain = watching();
    chain.describe("Listing origins");
    chain.finish({ title: "Found 1 origin", sections: [], lines: ["pattern  kind"] });

    expect(printed()).toContain("pattern  kind");
    expect(printed()).toContain("╭");
  });

  it("does not frame where it ran when there is nothing else to frame", () => {
    const chain = watching();
    chain.describe("Removing an origin");
    chain.ranAgainst("proj-1", "api.zitadel.cloud");
    chain.finish({ title: "Removed the origin", sections: [] });

    expect(printed()).toContain("Using project proj-1");
    expect(printed()).not.toContain("╭");
  });

  it("says where it ran as the last line of a box it does have", () => {
    const chain = watching();
    chain.describe("Listing origins");
    chain.ranAgainst("proj-1", "api.zitadel.cloud");
    chain.finish({ title: "Found 1 origin", sections: [], lines: ["a table"] });

    const box = printed();
    expect(box.indexOf("a table")).toBeLessThan(box.indexOf("Using project proj-1"));
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
});

import type { Config } from "@oclif/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@oclif/table", () => ({ makeTable: vi.fn(() => "  id\n ────\n  a\n") }));

import { makeTable } from "@oclif/table";

import { BaseCommand } from "../../../../src/lib/oclif/base";
import { Tabulatable } from "../../../../src/lib/oclif/tabulatable";

class Listing extends Tabulatable(BaseCommand) {
  public static override readonly id: string = "thing:list";

  constructor(argv: string[]) {
    super(argv, {
      version: "1.2.3",
      runHook: async () => ({ successes: [], failures: [] }),
    } as unknown as Config);
  }

  async run() {
    return this.emit({ status: "ok", data: {} });
  }

  table() {
    return this.tabulate(["id"], [{ id: "a" }]);
  }

  list() {
    return this.tabulateList(["id"], [{ id: "a" }], {
      plain: false,
      singular: "thing",
      empty: "No things.",
    });
  }
}

beforeEach(() => {
  vi.mocked(makeTable).mockClear();
});

describe("Tabulatable", () => {
  it("draws a table for a person", async () => {
    expect(await new Listing([]).table()).toBe("  id\n ────\n  a");
    expect(makeTable).toHaveBeenCalledTimes(1);
  });

  it("draws a list with its count for a person", async () => {
    expect(await new Listing([]).list()).toBe("  id\n ────\n  a\n\n1 thing");
  });

  it("draws nothing under --json, so a machine does not pay for a table it throws away", async () => {
    const command = new Listing(["--json"]);

    expect(await command.table()).toBe("");
    expect(await command.list()).toBe("");
    expect(makeTable).not.toHaveBeenCalled();
  });
});

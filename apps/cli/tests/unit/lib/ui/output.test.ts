import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Output } from "@/lib/ui";
import { asTerminal, offTerminal } from "@tests/fixtures/terminal";

describe("Output", () => {
  beforeEach(() => {
    Output.settle({ json: false, color: false });
  });

  afterEach(() => {
    Output.settle({ json: false, color: false });
  });

  it("is a plain, human run until the base command settles it", async () => {
    Output.settle({ json: true, color: true });
    vi.resetModules();

    const { Output: fresh } = await import("@/lib/ui/output");

    expect(fresh.json).toBe(false);
    expect(fresh.color).toBe(false);
  });

  it("reads back what was settled", () => {
    Output.settle({ json: true, color: false });

    expect(Output.json).toBe(true);
    expect(Output.color).toBe(false);
  });

  it("is a screen when stdout is a terminal", async () => {
    const screen = await asTerminal(async () => {
      return Output.screen;
    });

    expect(screen).toBe(true);
  });

  it("is not a screen when stdout is a pipe", async () => {
    const screen = await offTerminal(async () => {
      return Output.screen;
    });

    expect(screen).toBe(false);
  });
});

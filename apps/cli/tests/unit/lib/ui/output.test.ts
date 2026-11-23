import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Output } from "@/lib/ui";

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

  it("reports what the base command settled", () => {
    Output.settle({ json: true, color: false });

    expect(Output.json).toBe(true);
    expect(Output.color).toBe(false);
  });
});

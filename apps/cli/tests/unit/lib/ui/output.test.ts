import { afterEach, describe, expect, it } from "vitest";

import { Output } from "@/lib/ui";

describe("Output", () => {
  afterEach(() => {
    Output.settle({ json: false, color: false });
  });

  it("is a plain, human run until the base command settles it", () => {
    expect(Output.json).toBe(false);
    expect(Output.color).toBe(false);
  });

  it("reports what the base command settled", () => {
    Output.settle({ json: true, color: false });

    expect(Output.json).toBe(true);
    expect(Output.color).toBe(false);
  });
});

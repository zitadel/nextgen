import { describe, expect, it } from "vitest";

import { BrowserError } from "@/lib/browser";

describe("BrowserError", () => {
  it("reports the error the opener failed with", () => {
    const cause = Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" });

    expect(new BrowserError("spawn xdg-open ENOENT", cause)).toMatchObject({
      code: "E_VALIDATION",
      hint: undefined,
      details: { original: { name: "Error", message: "spawn xdg-open ENOENT", code: "ENOENT" } },
    });
  });
});

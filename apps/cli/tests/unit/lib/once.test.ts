import { describe, expect, it } from "vitest";

import { Once } from "@/lib/once";

describe("Once", () => {
  it("runs the first action and ignores the rest", () => {
    const once = new Once();
    const ran: string[] = [];

    once.run(() => {
      ran.push("first");
    });
    once.run(() => {
      ran.push("second");
    });

    expect(ran).toEqual(["first"]);
  });

  it("says whether it has run", () => {
    const once = new Once();

    expect(once.hasRun).toBe(false);
    once.run(() => {});
    expect(once.hasRun).toBe(true);
  });
});

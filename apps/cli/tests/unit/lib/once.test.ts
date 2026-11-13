import { describe, expect, it } from "vitest";

import { Lazy, Once } from "@/lib/once";

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

describe("Lazy", () => {
  it("makes nothing until it is asked", () => {
    const made: number[] = [];

    new Lazy(() => {
      made.push(1);
      return 1;
    });

    expect(made).toEqual([]);
  });

  it("makes the value once and shares it", () => {
    const made: number[] = [];
    const lazy = new Lazy(() => {
      made.push(1);
      return {};
    });

    expect(lazy.get()).toBe(lazy.get());
    expect(made).toHaveLength(1);
  });

  it("keeps a value that is undefined", () => {
    const made: number[] = [];
    const lazy = new Lazy(() => {
      made.push(1);
      return undefined;
    });

    lazy.get();
    lazy.get();

    expect(made).toHaveLength(1);
  });
});

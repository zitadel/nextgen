import { describe, expect, it, vi } from "vitest";

import { Lazy, Once } from "@/lib/once";

describe("Once", () => {
  it("runs the first action and ignores the rest", () => {
    const once = new Once();
    const first = vi.fn();
    const second = vi.fn();

    once.run(first);
    once.run(second);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
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
    const make = vi.fn(() => {
      return 1;
    });

    new Lazy(make);

    expect(make).not.toHaveBeenCalled();
  });

  it("makes the value once and shares it", () => {
    const make = vi.fn(() => {
      return {};
    });
    const lazy = new Lazy(make);

    expect(lazy.get()).toBe(lazy.get());
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("keeps a value that is undefined", () => {
    const make = vi.fn(() => {
      return undefined;
    });
    const lazy = new Lazy(make);

    lazy.get();
    lazy.get();

    expect(make).toHaveBeenCalledTimes(1);
  });
});

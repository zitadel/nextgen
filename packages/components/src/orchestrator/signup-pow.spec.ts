import { describe, expect, it } from "vitest";

import { stopIfAborted } from "./signup-pow.js";

describe("stopIfAborted", () => {
  // Chrome before 100 and Safari before 15.4 have no `AbortSignal.throwIfAborted`.
  const signal = (aborted: boolean) => ({ aborted }) as AbortSignal;

  it("reads only `aborted`, so it works where throwIfAborted is missing", () => {
    expect(() => stopIfAborted(signal(false))).not.toThrow();
    expect(() => stopIfAborted(undefined)).not.toThrow();
  });

  it("throws the AbortError a stopped check is told apart by", () => {
    expect(() => stopIfAborted(signal(true))).toThrow(
      expect.objectContaining({ name: "AbortError" }),
    );
  });
});

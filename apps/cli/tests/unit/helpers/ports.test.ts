import { describe, expect, it } from "vitest";

import { nextPort, PORT_WORKERS } from "@tests/helpers/ports";

const BLOCK = 50;

describe("nextPort", () => {
  it("hands out each port of the worker's block once, then starts again", () => {
    const first = nextPort();
    const rest = Array.from({ length: BLOCK - 1 }, () => {
      return nextPort();
    });

    expect(new Set([first, ...rest]).size).toBe(BLOCK);
    expect(nextPort()).toBe(first);
  });

  it("stays inside one block of consecutive ports", () => {
    const ports = Array.from({ length: BLOCK }, () => {
      return nextPort();
    });

    expect(Math.max(...ports) - Math.min(...ports)).toBe(BLOCK - 1);
  });
});

describe("PORT_WORKERS", () => {
  it("is how many blocks fit in the band", () => {
    expect(PORT_WORKERS).toBe(40);
  });
});

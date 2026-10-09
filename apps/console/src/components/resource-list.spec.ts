import { describe, expect, it } from "vitest";

import { opensRow } from "./resource-list";

/** A click as `opensRow` reads it: only the fields it inspects. */
function click(overrides: Record<string, unknown> = {}) {
  return {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: document.createElement("div"),
    ...overrides,
  } as unknown as Parameters<typeof opensRow>[0];
}

describe("opensRow", () => {
  it("opens on a plain primary click", () => {
    expect(opensRow(click())).toBe(true);
  });

  it("leaves modified clicks to the link", () => {
    // The browser opens these in a new tab or window; the row navigating this
    // one as well is the bug.
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
      expect(opensRow(click({ [modifier]: true }))).toBe(false);
    }
  });

  it("ignores non-primary buttons and handled clicks", () => {
    expect(opensRow(click({ button: 1 }))).toBe(false);
    expect(opensRow(click({ defaultPrevented: true }))).toBe(false);
  });

  it("opens when the target is not an element", () => {
    // `target` is typed `EventTarget`; anything without `closest` cannot be an
    // interactive child, so the row takes the click rather than throwing.
    expect(opensRow(click({ target: document }))).toBe(true);
    expect(opensRow(click({ target: null }))).toBe(true);
  });

  it("lets an interactive child own its own click", () => {
    for (const tag of ["a", "button", "input"]) {
      const row = document.createElement("div");
      const child = document.createElement(tag);
      row.append(child);
      expect(opensRow(click({ target: child }))).toBe(false);
    }
  });
});

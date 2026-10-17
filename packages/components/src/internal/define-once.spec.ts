import { afterEach, describe, expect, it, vi } from "vitest";

import { defineOnce } from "./define-once.js";

let tagSeq = 0;
const nextTag = () => `zl-define-once-${++tagSeq}`;

describe("defineOnce", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers an undefined tag", () => {
    const tag = nextTag();
    class First extends HTMLElement {}
    defineOnce(tag)(First);
    expect(customElements.get(tag)).toBe(First);
  });

  it("keeps the first definition when a second copy registers the same tag", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tag = nextTag();
    class First extends HTMLElement {}
    class Second extends HTMLElement {}
    defineOnce(tag)(First);
    expect(() => defineOnce(tag)(Second)).not.toThrow();
    expect(customElements.get(tag)).toBe(First);
  });

  it("warns when a different constructor claims a registered tag", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tag = nextTag();
    class First extends HTMLElement {}
    class Second extends HTMLElement {}
    defineOnce(tag)(First);
    defineOnce(tag)(Second);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`<${tag}>`));
  });

  it("stays silent when the same constructor is registered again", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tag = nextTag();
    class First extends HTMLElement {}
    defineOnce(tag)(First);
    defineOnce(tag)(First);
    expect(warn).not.toHaveBeenCalled();
  });

  it("lets a second evaluation of an element module load without throwing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("../orchestrator/zitadel-session.js");
    // A query string makes Vite evaluate a fresh copy of the module, as a
    // second package copy or an HMR re-run would.
    const copy: string = "../orchestrator/zitadel-session.js?copy";
    await expect(import(/* @vite-ignore */ copy)).resolves.toBeDefined();
  }, 30_000);
});

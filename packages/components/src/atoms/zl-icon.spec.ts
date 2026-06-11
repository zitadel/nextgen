import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-icon.js";
import { SHIPPED_ICON_NAMES } from "./zl-icon.js";
import type { ZlIcon } from "./zl-icon.js";

/**
 * `<zl-icon>` renders a curated Lucide glyph. The key invariant the code
 * comment promises ("keep playgrounds and parity tests in sync") is that
 * every name in `SHIPPED_ICON_NAMES` maps to a real glyph — asserted here so
 * a name added to the union without a node entry fails the build.
 */
describe("<zl-icon>", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  function mount(markup: string): ZlIcon {
    host.innerHTML = markup;
    return host.querySelector("zl-icon") as ZlIcon;
  }

  it.each(SHIPPED_ICON_NAMES)("renders non-empty svg markup for '%s'", async (name) => {
    const el = mount(`<zl-icon name="${name}"></zl-icon>`);
    await el.updateComplete;
    const svg = el.shadowRoot?.querySelector("svg");
    expect(svg, `no <svg> rendered for ${name}`).toBeTruthy();
    expect((svg?.innerHTML.length ?? 0) > 0, `empty glyph for ${name}`).toBe(true);
  });

  it("exposes an aria-label for labelled glyphs", async () => {
    const el = mount(`<zl-icon name="user"></zl-icon>`);
    await el.updateComplete;
    const svg = el.shadowRoot?.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("User");
  });

  it("hides the glyph from a11y when decorative", async () => {
    const el = mount(`<zl-icon name="user" decorative></zl-icon>`);
    await el.updateComplete;
    const svg = el.shadowRoot?.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("presentation");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("honours a custom label", async () => {
    const el = mount(`<zl-icon name="cross" label="Clear"></zl-icon>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("svg")?.getAttribute("aria-label")).toBe("Clear");
  });

  it("adds the spin modifier class when spin is set", async () => {
    const el = mount(`<zl-icon name="spinner" spin decorative></zl-icon>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".zr-icon")?.classList.contains("zr-icon--spin")).toBe(true);
  });

  it("adds a tone modifier class for non-default tones", async () => {
    const el = mount(`<zl-icon name="check" tone="success" decorative></zl-icon>`);
    await el.updateComplete;
    expect(
      el.shadowRoot?.querySelector(".zr-icon")?.classList.contains("zr-icon--tone-success"),
    ).toBe(true);
  });

  it("reflects size to the host attribute", async () => {
    const el = mount(`<zl-icon name="check" size="16" decorative></zl-icon>`);
    await el.updateComplete;
    expect(el.getAttribute("size")).toBe("16");
  });
});

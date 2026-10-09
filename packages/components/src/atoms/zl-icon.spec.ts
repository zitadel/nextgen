import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-icon.js";
import { SHIPPED_ICON_NAMES } from "./zl-icon.js";
import type { ZlIcon } from "./zl-icon.js";

/**
 * `<zl-icon>` renders a curated Lucide glyph. Every name in
 * `SHIPPED_ICON_NAMES` maps to a real glyph — asserted here so a name added
 * to the union without a node entry fails the build.
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
    expect(el.shadowRoot?.querySelector(".zr-icon")?.classList.contains("zr-icon--spin")).toBe(
      true,
    );
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

/**
 * Raised in review: a monochrome vendor mark (GitHub, Apple) must follow the
 * label colour, or it renders black on the dark provider button. The wrapper
 * already covers it -- the `<svg>` carries `fill="currentColor"`, which a
 * multi-coloured mark overrides per path and a monochrome one inherits -- so
 * this pins that rather than adding a flag to each entry.
 */
describe("brand marks and colour", () => {
  let brandHost: HTMLDivElement;

  beforeEach(() => {
    brandHost = document.createElement("div");
    document.body.appendChild(brandHost);
  });

  afterEach(() => {
    brandHost.remove();
  });

  it("leaves the svg on currentColor, so a mark with no per-path fill follows the label", async () => {
    brandHost.innerHTML = `<zl-icon name="brand-google" size="16" decorative></zl-icon>`;
    const el = brandHost.querySelector("zl-icon") as ZlIcon;
    await el.updateComplete;
    const svg = el.shadowRoot?.querySelector("svg");

    expect(svg?.getAttribute("fill")).toBe("currentColor");
    // Google's is the multi-coloured case: every path overrides it.
    const paths = [...(svg?.querySelectorAll("path") ?? [])];
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.every((path) => path.getAttribute("fill") !== null)).toBe(true);
  });
});

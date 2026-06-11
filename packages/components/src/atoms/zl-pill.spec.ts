import { afterEach, beforeEach, describe, expect, it } from "vitest";

import "./zl-pill.js";
import type { ZlPill } from "./zl-pill.js";

/**
 * Markup contract for `<zl-pill>`: it renders an `<a>` when `href` is set and
 * a `<span>` otherwise, applies a tone modifier for non-neutral tones, and
 * forwards `aria-label`. Locks the surface before the classMap refactor.
 */
describe("<zl-pill>", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  function mount(markup: string): ZlPill {
    host.innerHTML = markup;
    return host.querySelector("zl-pill") as ZlPill;
  }

  it("renders a link with rel when href is set", async () => {
    const el = mount(`<zl-pill href="https://zitadel.com">Secured</zl-pill>`);
    await el.updateComplete;
    const anchor = el.shadowRoot?.querySelector("a");
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute("href")).toBe("https://zitadel.com");
    expect(anchor?.getAttribute("rel")).toContain("noopener");
  });

  it("renders a span when no href is set", async () => {
    const el = mount(`<zl-pill>Status</zl-pill>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("a")).toBeNull();
    expect(el.shadowRoot?.querySelector("span.zr-pill")).toBeTruthy();
  });

  it("applies a tone modifier class for non-neutral tones", async () => {
    const el = mount(`<zl-pill tone="success">OK</zl-pill>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".zr-pill")?.classList.contains("zr-pill--success")).toBe(
      true,
    );
  });

  it("omits a tone modifier for the neutral tone", async () => {
    const el = mount(`<zl-pill tone="neutral">Neutral</zl-pill>`);
    await el.updateComplete;
    const pill = el.shadowRoot?.querySelector(".zr-pill");
    expect(pill?.classList.contains("zr-pill")).toBe(true);
    expect([...(pill?.classList ?? [])].some((c) => c.startsWith("zr-pill--"))).toBe(false);
  });

  it("forwards aria-label to the rendered element", async () => {
    const el = mount(`<zl-pill href="https://zitadel.com" aria-label="Secured with Zitadel">x</zl-pill>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("a")?.getAttribute("aria-label")).toBe(
      "Secured with Zitadel",
    );
  });
});

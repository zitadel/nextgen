import { describe, expect } from "vitest";

import "./zl-pill.js";
import type { ZlPill } from "./zl-pill.js";
import { it } from "../test/fixtures.js";

/**
 * Markup contract for `<zl-pill>`: it renders an `<a>` when `href` is set and
 * a `<span>` otherwise, applies a tone modifier for non-neutral tones, and
 * forwards `aria-label`. Locks the surface before the classMap refactor.
 */
describe("<zl-pill>", () => {
  it("renders a link with rel when href is set", async ({ render }) => {
    const el = await render<ZlPill>(`<zl-pill href="https://zitadel.com">Secured</zl-pill>`);
    await el.updateComplete;
    const anchor = el.shadowRoot?.querySelector("a");
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute("href")).toBe("https://zitadel.com");
    expect(anchor?.getAttribute("rel")).toContain("noopener");
  });

  it("renders a span when no href is set", async ({ render }) => {
    const el = await render<ZlPill>(`<zl-pill>Status</zl-pill>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("a")).toBeNull();
    expect(el.shadowRoot?.querySelector("span.zr-pill")).toBeTruthy();
  });

  it("applies a tone modifier class for non-neutral tones", async ({ render }) => {
    const el = await render<ZlPill>(`<zl-pill tone="success">OK</zl-pill>`);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".zr-pill")?.classList.contains("zr-pill--success")).toBe(
      true,
    );
  });

  it("omits a tone modifier for the neutral tone", async ({ render }) => {
    const el = await render<ZlPill>(`<zl-pill tone="neutral">Neutral</zl-pill>`);
    await el.updateComplete;
    const pill = el.shadowRoot?.querySelector(".zr-pill");
    expect(pill?.classList.contains("zr-pill")).toBe(true);
    expect([...(pill?.classList ?? [])].some((c) => c.startsWith("zr-pill--"))).toBe(false);
  });

  it("forwards aria-label to the rendered element", async ({ render }) => {
    const el = await render<ZlPill>(
      `<zl-pill href="https://zitadel.com" aria-label="Secured with Zitadel">x</zl-pill>`,
    );
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("a")?.getAttribute("aria-label")).toBe(
      "Secured with Zitadel",
    );
  });
});

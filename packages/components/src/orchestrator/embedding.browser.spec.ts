import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { ZitadelProject } from "@zitadel/api/config";
import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import "./zitadel-login.js";
import heroTemplate from "../../../config/defaults/branding/hero/login.liquid";
import minimalTemplate from "../../../config/defaults/branding/minimal/login.liquid";
import splitRightTemplate from "../../../config/defaults/branding/split-right/login.liquid";
// Raw import via the liquidRaw Vite plugin — @zitadel/config/defaults reads
// files with node:fs at call time, which cannot run inside Chromium.
import splitTemplate from "../../../config/defaults/branding/split/login.liquid";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * Real-browser checks for the widget-first embedding contract.
 *
 * `<zitadel-login>` defaults to `variant="widget"`: content-sized,
 * transparent through EVERY layer (host, `zl-page-shell` host, inner
 * `.zr-page-shell` — asserting only the outer host is how a black page
 * shell once hid behind a "transparent" widget), no design-system font
 * injected into the host document, no focus grab on initial load.
 * Dedicated login routes opt into `variant="page"`, which restores the
 * full-page shape: viewport min-height, surface background, brand font,
 * and initial focus.
 *
 * Width-responsive chrome is container-based: a narrow host on a wide
 * viewport collapses the split layout exactly like a phone would.
 */

const identifierStep: CreateFlow201 = {
  id: "flow_1",
  session_id: "sess_1",
  session_token: "tok_1",
  step: {
    name: "identifier",
    texts: { title_key: "identifier.title" },
    fields: [{ name: "email", type: "email", text_key: "identifier.field.email", required: true }],
    actions: [{ name: "submit", kind: "submit", text_key: "submit.continue", primary: true }],
    gates: {},
  },
};

const selectOnlyStep: CreateFlow201 = {
  ...identifierStep,
  step: {
    ...identifierStep.step,
    name: "profile",
    fields: [
      {
        name: "department",
        type: "select",
        text_key: "profile.field.department",
        required: true,
        validation: { enum: ["Engineering", "Support"] },
      },
    ],
  },
};

const fieldlessStep: CreateFlow201 = {
  ...identifierStep,
  step: {
    ...identifierStep.step,
    name: "passkey-first",
    texts: { title_key: "passkey-first.title" },
    fields: [],
    actions: [
      {
        name: "passkey",
        kind: "passkey",
        text_key: "passkey-first.action.passkey",
        primary: true,
      },
    ],
  },
};

/**
 * A branding asset URL that genuinely loads in the test browser. It has to
 * be same-origin (the vitest server is loopback http, which
 * `validateBranding` allows for assets, unlike a `data:` URI) and it has to
 * decode: an unreachable host now degrades to a hidden image plus the split
 * placeholder (`asset-fallback.ts`), which is the opposite of what the
 * layout tests below want to measure.
 */
const LOADABLE_ASSET = `${location.origin}/src/orchestrator/__fixtures__/asset.svg`;
const BROKEN_ASSET = `${location.origin}/src/orchestrator/__fixtures__/does-not-exist.svg`;
/** Square, and carrying a viewBox but no width/height — see the fixture. */
const SQUARE_ASSET = `${location.origin}/src/orchestrator/__fixtures__/square-unsized-asset.svg`;
const WIDE_ASSET = `${location.origin}/src/orchestrator/__fixtures__/wide-banner-asset.svg`;
/** Sized, 1:4 — the shape the brand pane's width cap does *not* bound. */
const TALL_ASSET = `${location.origin}/src/orchestrator/__fixtures__/tall-logo-asset.svg`;

/** The shipped split design carried as tenant branding, logo-less. */
const splitHeroOnlyStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitTemplate,
    hero_url: LOADABLE_ASSET,
  },
} as unknown as CreateFlow201;

/** Same design, pointed at the two hero shapes the height cap has to separate. */
const splitSquareHeroStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitTemplate,
    hero_url: SQUARE_ASSET,
  },
} as unknown as CreateFlow201;

const splitWideHeroStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitTemplate,
    hero_url: WIDE_ASSET,
  },
} as unknown as CreateFlow201;

const splitTallLogoStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitTemplate,
    logo_url: TALL_ASSET,
  },
} as unknown as CreateFlow201;

/** Both assets at once — the pane stacks them, so the caps share one budget. */
const splitBothAssetsStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitTemplate,
    logo_url: TALL_ASSET,
    hero_url: SQUARE_ASSET,
  },
} as unknown as CreateFlow201;

/** The shipped split design with a logo: the compact fallback is a capped <img>. */
const splitLogoStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitTemplate,
    logo_url: LOADABLE_ASSET,
  },
} as unknown as CreateFlow201;

/** Same design, pointed at a host that does not resolve. */
const splitBrokenLogoStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitTemplate,
    logo_url: BROKEN_ASSET,
  },
} as unknown as CreateFlow201;

/** The shipped split designs with no assets exercise the decorative placeholder. */
const splitNoAssetsStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitTemplate,
  },
} as unknown as CreateFlow201;

const splitRightNoAssetsStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitRightTemplate,
  },
} as unknown as CreateFlow201;

const splitCustomColumnsStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitTemplate.replace(
      "<zl-page-shell data-zl-template-root>",
      '<zl-page-shell data-zl-template-root style="--zl-split-columns: 7fr 5fr">',
    ),
  },
} as unknown as CreateFlow201;

/** The hero design, logo-less: its compact fallback is a <p>, not an <img>. */
const heroNoLogoStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: heroTemplate,
  },
} as unknown as CreateFlow201;

/** A configured hero logo whose request fails must recover both authored fallbacks. */
const heroBrokenLogoStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: heroTemplate,
    logo_url: BROKEN_ASSET,
  },
} as unknown as CreateFlow201;

/** The shipped minimal design: fields straight on the page, no card. The
 * wire `layout` enum is `centered | split` (ADR 040) — richer designs ride
 * in `liquid_template` and declare the layout they degrade to. */
const minimalStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "centered",
    liquid_template: minimalTemplate,
  },
} as unknown as CreateFlow201;

const TRANSPARENT = "rgba(0, 0, 0, 0)";

function installFlowFetchStub(responses: readonly CreateFlow201[]): { restore: () => void } {
  let cursor = 0;
  const fetchStub = vi.fn(async (): Promise<Response> => {
    const next = responses[Math.min(cursor, responses.length - 1)];
    cursor += 1;
    return new Response(JSON.stringify(next), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  });
  const original = globalThis.fetch;
  globalThis.fetch = fetchStub as unknown as typeof fetch;
  return { restore: () => void (globalThis.fetch = original) };
}

function centerX(element: Element): number {
  const rect = element.getBoundingClientRect();
  return (rect.left + rect.right) / 2;
}

async function waitFor<T>(probe: () => T | null | undefined, timeout = 3000): Promise<T> {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  throw new Error("waitFor timed out");
}

/**
 * Asset-sizing assertions are meaningless against a pending `<img>`: the
 * intrinsic dimensions the layout derives from only exist once it has decoded.
 */
async function loadedImage(element: ZitadelLogin, selector: string): Promise<HTMLImageElement> {
  return waitFor(() => {
    const img = element.shadowRoot?.querySelector(selector) as HTMLImageElement | null;
    return img?.complete && img.naturalWidth > 0 ? img : null;
  });
}

describe("<zitadel-login> widget-first embedding (chromium)", () => {
  let host: HTMLDivElement;
  let stub: ReturnType<typeof installFlowFetchStub> | undefined;
  let project: ZitadelProject;
  let resetViewport = false;

  beforeEach(() => {
    _resetConfigForTesting();
    project = configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "embed-test",
      url: "http://localhost:4000",
    });
    host = document.createElement("div");
    host.style.width = "360px";
    document.body.appendChild(host);
  });

  afterEach(async () => {
    host.remove();
    stub?.restore();
    // The font links are document-level state the orchestrator manages on
    // update; isolate tests from each other.
    document.getElementById("zl-default-font-link")?.remove();
    document.getElementById("zl-font-link")?.remove();
    if (resetViewport) {
      resetViewport = false;
      await page.viewport(1440, 900);
    }
  });

  async function mount(
    response: CreateFlow201,
    configure?: (el: ZitadelLogin) => void,
  ): Promise<ZitadelLogin> {
    stub = installFlowFetchStub([response]);
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = project;
    configure?.(element);
    host.appendChild(element);
    await waitFor(() =>
      element.shadowRoot?.querySelector("zl-field, zl-select, zl-checkbox, zl-button")
        ? element
        : null,
    );
    await waitFor(() => (element.getAttribute("aria-busy") === "false" ? element : null));
    // Let hydrate (values + focus pass) settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 150));
    return element;
  }

  it("widget default: content-sized, and transparent through every layer", async () => {
    const element = await mount(identifierStep);
    expect(element.getAttribute("variant")).toBe("widget");

    const rect = element.getBoundingClientRect();
    expect(rect.height).toBeGreaterThan(0);

    // Content-sized means the shell contributes no padding of its own: the
    // card sits flush with the host's top edge and nothing but real content
    // (the attribution pill) sits below it. A 682px host around a 514px
    // card — page padding surviving into widget mode — is the double-card
    // dead space this pins against.
    const card = element.shadowRoot?.querySelector("zl-card") as HTMLElement;
    expect(card).toBeTruthy();
    expect(Math.abs(card.getBoundingClientRect().top - rect.top)).toBeLessThanOrEqual(1);
    const attribution = element.shadowRoot?.querySelector(".zl-attribution") as HTMLElement;
    expect(attribution).toBeTruthy();
    expect(Math.abs(attribution.getBoundingClientRect().bottom - rect.bottom)).toBeLessThanOrEqual(
      1,
    );

    // Outer host.
    expect(getComputedStyle(element).backgroundColor).toBe(TRANSPARENT);
    // Inner layers — the gap an outer-host-only assertion once left open.
    const shell = element.shadowRoot?.querySelector("zl-page-shell") as HTMLElement;
    expect(shell).toBeTruthy();
    expect(shell.hasAttribute("data-widget")).toBe(true);
    expect(getComputedStyle(shell).backgroundColor).toBe(TRANSPARENT);
    const surface = shell.shadowRoot?.querySelector(".zr-page-shell") as HTMLElement;
    expect(surface).toBeTruthy();
    expect(getComputedStyle(surface).backgroundColor).toBe(TRANSPARENT);
    // The padded 48rem branch is live in this viewport, so this pins the
    // widget override beating the media query, not just the narrow default.
    expect(getComputedStyle(surface).padding).toBe("0px");
  });

  it("widget default: no design-system font is injected into the host document", async () => {
    await mount(identifierStep);
    expect(document.getElementById("zl-default-font-link")).toBeNull();
  });

  it("widget default: does not steal focus on initial load", async () => {
    const element = await mount(identifierStep);
    expect(element.shadowRoot?.activeElement).toBeNull();
    expect(document.activeElement).toBe(document.body);
  });

  it("variant=page restores the full-page shape, font, and initial focus", async () => {
    const element = await mount(identifierStep, (el) => {
      el.variant = "page";
    });
    const mountNode = element.shadowRoot?.querySelector(".zl-mount") as HTMLElement;
    expect(mountNode.getBoundingClientRect().height).toBeGreaterThanOrEqual(window.innerHeight - 1);
    expect(getComputedStyle(element).backgroundColor).not.toBe(TRANSPARENT);
    expect(document.getElementById("zl-default-font-link")).not.toBeNull();
    const field = element.shadowRoot?.querySelector("zl-field");
    await waitFor(() => (element.shadowRoot?.activeElement === field ? field : null));
    expect(element.shadowRoot?.activeElement).toBe(field);
  });

  it("variant=page focuses a select when it is the first field", async () => {
    const element = await mount(selectOnlyStep, (el) => {
      el.variant = "page";
    });
    const select = element.shadowRoot?.querySelector("zl-select");
    expect(select).toBeTruthy();
    await waitFor(() => (element.shadowRoot?.activeElement === select ? select : null));
    expect(element.shadowRoot?.activeElement).toBe(select);
  });

  it("variant=page leaves a fieldless initial step unfocused", async () => {
    const element = await mount(fieldlessStep, (el) => {
      el.variant = "page";
    });
    expect(element.shadowRoot?.querySelector("zl-button")).toBeTruthy();
    expect(element.shadowRoot?.activeElement).toBeNull();
  });

  it("--zl-page-min-height still overrides the widget default", async () => {
    const element = await mount(identifierStep, (el) => {
      el.style.setProperty("--zl-page-min-height", "40rem");
    });
    const mountNode = element.shadowRoot?.querySelector(".zl-mount") as HTMLElement;
    expect(getComputedStyle(mountNode).minHeight).toBe("640px");
  });

  it("minimal design in widget mode sheds its page padding too", async () => {
    // The minimal design has no card, so its pane padding IS the page
    // chrome — in widget mode it must collapse exactly like the shell's
    // padding did, or a minimal-layout tenant gets 52px dead space above
    // and below the fields inside an embedder's own container.
    const element = await mount(minimalStep);
    const rect = element.getBoundingClientRect();
    const minimal = element.shadowRoot?.querySelector(".zl-minimal") as HTMLElement;
    expect(minimal).toBeTruthy();
    expect(getComputedStyle(minimal).padding).toBe("0px");
    expect(Math.abs(minimal.getBoundingClientRect().top - rect.top)).toBeLessThanOrEqual(1);
    const attribution = element.shadowRoot?.querySelector(".zl-attribution") as HTMLElement;
    expect(attribution).toBeTruthy();
    expect(Math.abs(attribution.getBoundingClientRect().bottom - rect.bottom)).toBeLessThanOrEqual(
      1,
    );
  });

  it("minimal design keeps its page padding in page mode", async () => {
    const element = await mount(minimalStep, (el) => {
      el.variant = "page";
    });
    const minimal = element.shadowRoot?.querySelector(".zl-minimal") as HTMLElement;
    expect(getComputedStyle(minimal).padding).toBe("52px 16px");
  });

  it("split pane padding is composition, not page chrome — it survives widget mode", async () => {
    // Deliberate asymmetry with the minimal design: the split panes' padding
    // separates the two panes' content (brand from form), so zeroing it in
    // widget mode would smash the design against the widget edge with no
    // host-CSS recourse — it lives inside the shadow chrome. Pinned so a
    // future "widgets never pad" sweep has to argue with this test first.
    const element = await mount(splitHeroOnlyStep);
    const form = element.shadowRoot?.querySelector(".zl-split__form") as HTMLElement;
    expect(form).toBeTruthy();
    expect(getComputedStyle(form).padding).toBe("16px");
    const brand = element.shadowRoot?.querySelector(".zl-split__brand") as HTMLElement;
    expect(getComputedStyle(brand).padding).toBe("52px 16px");
  });

  it("wide split placeholder and attribution stay centred on the form track", async () => {
    host.style.width = "1200px";
    const element = await mount(splitNoAssetsStep, (el) => {
      el.variant = "page";
    });
    const placeholder = element.shadowRoot?.querySelector(".zl-split__placeholder") as HTMLElement;
    const form = element.shadowRoot?.querySelector(".zl-split__form") as HTMLElement;
    const pill = element.shadowRoot?.querySelector(".zl-attribution > *") as HTMLElement;
    expect(getComputedStyle(placeholder).display).not.toBe("none");
    expect(placeholder.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(Math.abs(centerX(form) - centerX(pill))).toBeLessThanOrEqual(1);
  });

  it("wide split-right attribution stays centred on the mirrored form track", async () => {
    host.style.width = "1200px";
    const element = await mount(splitRightNoAssetsStep, (el) => {
      el.variant = "page";
    });
    const form = element.shadowRoot?.querySelector(".zl-split__form") as HTMLElement;
    const pill = element.shadowRoot?.querySelector(".zl-attribution > *") as HTMLElement;
    expect(Math.abs(centerX(form) - centerX(pill))).toBeLessThanOrEqual(1);
  });

  it("custom split column tracks also carry through to the attribution row", async () => {
    host.style.width = "1200px";
    const element = await mount(splitCustomColumnsStep, (el) => {
      el.variant = "page";
    });
    const form = element.shadowRoot?.querySelector(".zl-split__form") as HTMLElement;
    const pill = element.shadowRoot?.querySelector(".zl-attribution > *") as HTMLElement;
    expect(Math.abs(centerX(form) - centerX(pill))).toBeLessThanOrEqual(1);
  });

  it("collapsed no-asset split keeps the form and attribution at the container width", async () => {
    host.style.width = "600px";
    const element = await mount(splitNoAssetsStep, (el) => {
      el.variant = "page";
    });
    const split = element.shadowRoot?.querySelector(".zl-split") as HTMLElement;
    const card = element.shadowRoot?.querySelector("zl-card") as HTMLElement;
    const pill = element.shadowRoot?.querySelector(".zl-attribution > *") as HTMLElement;
    expect(split.getBoundingClientRect().width).toBeGreaterThan(500);
    expect(card.getBoundingClientRect().width).toBeGreaterThan(300);
    expect(Math.abs(centerX(split) - centerX(pill))).toBeLessThanOrEqual(1);
  });

  it("split chrome collapses to the widget's width, not the viewport's", async () => {
    // 360px host on the (wide) test viewport: a viewport media query would
    // keep two columns and hide the compact fallback — the container query
    // must collapse to one column and reveal it.
    const element = await mount(splitHeroOnlyStep);
    const brand = element.shadowRoot?.querySelector(".zl-split__brand") as HTMLElement;
    expect(brand).toBeTruthy();
    expect(getComputedStyle(brand).display).toBe("none");
    const compact = element.shadowRoot?.querySelector(".zl-split__compact") as HTMLElement;
    expect(compact).toBeTruthy();
    expect(getComputedStyle(compact).display).not.toBe("none");
    // hero_url-only tenants get the banner variant of the fallback.
    expect(compact.classList.contains("zl-split__compact--hero")).toBe(true);
  });

  it("the compact fallback height cap applies to images, never to text", async () => {
    // The hero design's compact fallback is a <p>, and its copy is meant to
    // be edited — a fixed height cap inherited from the <img> case would clip
    // any brand name that wraps. Images keep the cap; text must not have one.
    const element = await mount(heroNoLogoStep);
    const compact = element.shadowRoot?.querySelector(".zl-split__compact") as HTMLElement;
    expect(compact.tagName).toBe("P");
    expect(getComputedStyle(compact).display).not.toBe("none");
    expect(getComputedStyle(compact).maxHeight).toBe("none");

    // Two lines of tenant copy must render in full, not be clipped.
    compact.textContent = "A rather long tenant brand name that wraps";
    await new Promise((resolve) => setTimeout(resolve, 32));
    expect(compact.getBoundingClientRect().height).toBeGreaterThan(30);
    expect(compact.scrollHeight).toBeLessThanOrEqual(compact.clientHeight + 1);

    // Images keep their caps, and the two image cases stay distinct: a logo
    // is held to 2.5rem, the hero banner to 6rem. Both rules are `img`-
    // qualified so source order decides — an unqualified banner rule would
    // lose to the qualified logo rule on specificity and silently shrink.
    const withLogo = await mount(splitLogoStep);
    const logo = withLogo.shadowRoot?.querySelector(".zl-split__compact") as HTMLElement;
    expect(logo.tagName).toBe("IMG");
    expect(getComputedStyle(logo).maxHeight).toBe("40px");

    const withHero = await mount(splitHeroOnlyStep);
    const banner = withHero.shadowRoot?.querySelector(".zl-split__compact") as HTMLElement;
    expect(banner.tagName).toBe("IMG");
    expect(getComputedStyle(banner).maxHeight).toBe("96px");
  });

  it("a square hero asset cannot grow the brand pane past the viewport", async () => {
    // The reported failure: `hero_url` pointed at a framework scaffold's own
    // `public/globe.svg` — square, and with no intrinsic size, so it laid out
    // at the brand pane's width and squared itself (656×656). The pane is
    // content-sized, so that became the page height (1028px at a 900px
    // viewport) and pushed the attribution below the fold.
    host.style.width = "1200px";
    const element = await mount(splitSquareHeroStep, (el) => {
      el.variant = "page";
    });

    const hero = await loadedImage(element, "img.zl-split__hero");
    const heroRect = hero.getBoundingClientRect();
    // Still a pane-filling hero, not a stamp — the cap bounds height only.
    expect(heroRect.width).toBeGreaterThan(400);
    expect(heroRect.height).toBeLessThan(heroRect.width);

    const brand = element.shadowRoot?.querySelector(".zl-split__brand") as HTMLElement;
    expect(brand.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight);
    // Page mode floors the mount at 100vh; it must not have grown past it.
    const mountNode = element.shadowRoot?.querySelector(".zl-mount") as HTMLElement;
    expect(mountNode.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight + 1);

    const cap = parseFloat(getComputedStyle(hero).maxHeight);
    expect(cap).toBeGreaterThan(0);
    expect(heroRect.height).toBeLessThanOrEqual(cap + 1);
    // The cap crops rather than distorts; `contain` here would letterbox the
    // asset back into the same square footprint the cap just removed.
    expect(getComputedStyle(hero).objectFit).toBe("cover");
  });

  it("the hero height cap leaves a conventional wide banner uncropped", async () => {
    // The other half of the cap: it may not turn into a fixed slot. A landscape
    // banner's height never reaches the cap, so it keeps its own ratio and
    // `object-fit` stays a no-op — the tenant sees the whole asset.
    host.style.width = "1200px";
    const element = await mount(splitWideHeroStep, (el) => {
      el.variant = "page";
    });

    const hero = await loadedImage(element, "img.zl-split__hero");
    const heroRect = hero.getBoundingClientRect();
    const intrinsicRatio = hero.naturalWidth / hero.naturalHeight;
    expect(heroRect.width / heroRect.height).toBeCloseTo(intrinsicRatio, 1);
  });

  it("the collapsed compact banner caps the same square asset", async () => {
    // Narrow container: the brand pane is gone and the hero rides in the form
    // pane instead. Its `width: 100%` is what makes the 6rem cap bite — without
    // it the same asset would square itself off the form pane's width and wall
    // off the card.
    const element = await mount(splitSquareHeroStep);
    const banner = await loadedImage(element, "img.zl-split__compact--hero");
    const rect = banner.getBoundingClientRect();
    expect(rect.width).toBeGreaterThan(100);
    expect(rect.height).toBeLessThanOrEqual(96 + 1);
  });

  it("a tall logo asset cannot grow the brand pane past the viewport", async () => {
    // The hero's sibling defect. `max-width: min(16rem, 60%)` bounds one axis
    // only, so a 1:4 portrait lockup clamped to 256px wide still resolved to
    // 1024px tall and handed that to the content-sized pane. A square asset
    // does not reproduce this — the width cap already squares it off at 256.
    host.style.width = "1200px";
    const element = await mount(splitTallLogoStep, (el) => {
      el.variant = "page";
    });

    const logo = await loadedImage(element, "img.zl-split__logo");
    const brand = element.shadowRoot?.querySelector(".zl-split__brand") as HTMLElement;
    expect(brand.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight);
    const mountNode = element.shadowRoot?.querySelector(".zl-mount") as HTMLElement;
    expect(mountNode.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight + 1);

    const rect = logo.getBoundingClientRect();
    const cap = parseFloat(getComputedStyle(logo).maxHeight);
    expect(cap).toBeGreaterThan(0);
    expect(rect.height).toBeLessThanOrEqual(cap + 1);
    // Deliberately unlike the hero: no pinned width, so the cap shrinks both
    // axes and the mark keeps its whole shape. Cropping a logo loses brand.
    expect(rect.width / rect.height).toBeCloseTo(logo.naturalWidth / logo.naturalHeight, 1);
  });

  it("a logo and a hero together stay inside the whole page shell's budget", async () => {
    // Capping each image on its own is not enough. The templates render both
    // when a tenant sets both, and the brand pane's padding and gap are only
    // half the chrome they compete with: the shell adds 3.25rem of block
    // padding, a region gap, and the attribution row. At their solo caps the
    // pair measured an 824px pane inside a 976px document at 1440×900 — the
    // attribution back below the fold, which is what the caps exist to stop.
    // This is still a desktop-width split pane, but its 800px height exposed
    // the stale arithmetic in the first combined cap (864px mount).
    resetViewport = true;
    await page.viewport(1200, 800);
    expect(window.innerHeight).toBe(800);
    host.style.width = "1200px";
    const element = await mount(splitBothAssetsStep, (el) => {
      el.variant = "page";
    });

    // Both are really rendering — a budget met by dropping one asset is no fix.
    const logo = await loadedImage(element, "img.zl-split__logo");
    const hero = await loadedImage(element, "img.zl-split__hero");
    expect(logo.getBoundingClientRect().height).toBeGreaterThan(0);
    expect(hero.getBoundingClientRect().height).toBeGreaterThan(0);

    const brand = element.shadowRoot?.querySelector(".zl-split__brand") as HTMLElement;
    expect(brand.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight);
    const mountNode = element.shadowRoot?.querySelector(".zl-mount") as HTMLElement;
    expect(mountNode.getBoundingClientRect().height).toBeLessThanOrEqual(window.innerHeight + 1);
    // The user-visible invariant behind the whole budget: the badge is on screen.
    const pill = element.shadowRoot?.querySelector(".zl-attribution > *") as HTMLElement;
    expect(pill.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
  });

  it("the logo cap never stretches a small logo to the pane", async () => {
    // The other direction of the same rule. `.zl-split__hero` pins `width:
    // 100%`, which upscales a small asset; the logo must not inherit that —
    // a 64px brand mark blown up to a 536px pane is a blurry mess.
    host.style.width = "1200px";
    const element = await mount(splitLogoStep, (el) => {
      el.variant = "page";
    });

    const logo = await loadedImage(element, "img.zl-split__logo");
    const rect = logo.getBoundingClientRect();
    expect(rect.width).toBeCloseTo(logo.naturalWidth, 0);
    expect(rect.height).toBeCloseTo(logo.naturalHeight, 0);
  });

  it("a branding asset that fails to load degrades to the split placeholder", async () => {
    // The reported failure: a well-formed but dead logo_url clears the CLI
    // gate and the server gate, then renders as a 0×0 img — the templates'
    // own placeholder is keyed on "no asset configured", so the brand pane
    // was left blank with nothing in the console.
    host.style.width = "1200px";
    const element = await mount(splitBrokenLogoStep, (el) => {
      el.variant = "page";
    });

    const logo = await waitFor(() =>
      element.shadowRoot?.querySelector("img.zl-split__logo[data-zl-asset-broken]"),
    );
    // The recovery has to be scripted: DOMPurify strips inline `onerror`, so
    // no template could do this for itself.
    expect(getComputedStyle(logo).display).toBe("none");

    const placeholder = await waitFor(() =>
      element.shadowRoot?.querySelector(".zl-split__placeholder"),
    );
    expect(placeholder.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  it("a broken hero logo restores the compact text fallback at narrow widths", async () => {
    const element = await mount(heroBrokenLogoStep);
    await waitFor(() =>
      element.shadowRoot?.querySelector("img.zl-split__compact[data-zl-asset-broken]"),
    );

    const brandPane = element.shadowRoot?.querySelector(".zl-split__brand") as HTMLElement;
    expect(getComputedStyle(brandPane).display).toBe("none");

    const fallback = await waitFor(() =>
      element.shadowRoot?.querySelector(".zl-split__form > .zl-hero__compact-brand:not([hidden])"),
    );
    expect(getComputedStyle(fallback).display).not.toBe("none");
    expect(fallback.textContent).toContain("Your brand");
  });
});

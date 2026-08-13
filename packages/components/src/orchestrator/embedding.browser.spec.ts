import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { ZitadelProject } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";
// Raw import via the liquidRaw Vite plugin — @zitadel/config/defaults reads
// files with node:fs at call time, which cannot run inside Chromium.
import splitTemplate from "../../../config/defaults/branding/split/login.liquid";
import splitRightTemplate from "../../../config/defaults/branding/split-right/login.liquid";
import heroTemplate from "../../../config/defaults/branding/hero/login.liquid";
import minimalTemplate from "../../../config/defaults/branding/minimal/login.liquid";

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
    fields: [
      { name: "email", type: "email", text_key: "identifier.field.email", required: true },
    ],
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

/** The shipped split design carried as tenant branding, logo-less. */
const splitHeroOnlyStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitTemplate,
    hero_url: "https://cdn.example.com/hero.png",
  },
} as unknown as CreateFlow201;

/** The shipped split design with a logo: the compact fallback is a capped <img>. */
const splitLogoStep: CreateFlow201 = {
  ...identifierStep,
  branding: {
    layout: "split",
    liquid_template: splitTemplate,
    logo_url: "https://cdn.example.com/logo.png",
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

describe("<zitadel-login> widget-first embedding (chromium)", () => {
  let host: HTMLDivElement;
  let stub: ReturnType<typeof installFlowFetchStub> | undefined;
  let project: ZitadelProject;

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

  afterEach(() => {
    host.remove();
    stub?.restore();
    // The font links are document-level state the orchestrator manages on
    // update; isolate tests from each other.
    document.getElementById("zl-default-font-link")?.remove();
    document.getElementById("zl-font-link")?.remove();
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
    expect(mountNode.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      window.innerHeight - 1,
    );
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
});

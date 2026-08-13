import type { CreateFlow201 } from "@zitadel/api/generated/model";
import { configureZitadel, _resetConfigForTesting } from "@zitadel/api/config";
import type { ZitadelProject } from "@zitadel/api/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zitadel-login.js";
import type { ZitadelLogin } from "./zitadel-login.js";

/**
 * The embedding developer's contract, exercised the way they would use it:
 * drop `<zitadel-login>` into an existing app and drive its look and
 * behaviour from the host page.
 *
 * The load-bearing claim is Tier 1 of the override ladder — a plain
 * `zitadel-login { --zl-*: … }` rule in the app's own stylesheet. It has to
 * survive two shadow boundaries (orchestrator → atom) and outrank the token
 * sheets the orchestrator adopts internally, including the tenant branding
 * layer. Per the CSS cascade's encapsulation-context step, normal
 * declarations from the outer tree beat `:host` rules in an inner tree; this
 * pins that we actually depend on that and never regress it by reaching for
 * `!important` or inline styles on the host element.
 *
 * Sizing/theme/parts are covered by `embedding`, `theme`, and `exportparts`
 * specs respectively; this file covers styling authority, placement, and the
 * experience knobs a host app drives.
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

/** The same step, but with a tenant that has its own brand colour set. */
const brandedStep: CreateFlow201 = {
  ...identifierStep,
  branding: { theme: { mode: "dark" }, palette: { primary: "#00ff00" } },
} as unknown as CreateFlow201;

const HOST_RED = "rgb(255, 0, 0)";

function installFlowFetchStub(response: CreateFlow201): { restore: () => void } {
  const original = globalThis.fetch;
  globalThis.fetch = vi.fn(
    async (): Promise<Response> =>
      new Response(JSON.stringify(response), {
        status: 201,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
  return { restore: () => void (globalThis.fetch = original) };
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

describe("<zitadel-login> host-app customisation (chromium)", () => {
  let host: HTMLDivElement;
  let appStyle: HTMLStyleElement | undefined;
  let stub: ReturnType<typeof installFlowFetchStub> | undefined;
  let project: ZitadelProject;

  beforeEach(() => {
    _resetConfigForTesting();
    project = configureZitadel({
      proxyPath: "/__nextgen",
      projectId: "custom-test",
      url: "http://localhost:4000",
    });
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
    appStyle?.remove();
    appStyle = undefined;
    stub?.restore();
    document.getElementById("zl-default-font-link")?.remove();
    document.getElementById("zl-font-link")?.remove();
  });

  /** Stand in for the embedding app's own stylesheet. */
  function appStylesheet(css: string): void {
    appStyle = document.createElement("style");
    appStyle.textContent = css;
    document.head.appendChild(appStyle);
  }

  async function mount(
    response: CreateFlow201,
    configure?: (el: ZitadelLogin) => void,
  ): Promise<ZitadelLogin> {
    stub = installFlowFetchStub(response);
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = "login";
    element.project = project;
    configure?.(element);
    host.appendChild(element);
    await waitFor(() => (element.shadowRoot?.querySelector("zl-field") ? element : null));
    await waitFor(() => (element.getAttribute("aria-busy") === "false" ? element : null));
    await new Promise((resolve) => setTimeout(resolve, 150));
    return element;
  }

  it("host-page --zl-* tokens repaint through both shadow boundaries", async () => {
    appStylesheet(`zitadel-login { --zl-color-text-primary-white: ${HOST_RED}; }`);
    const element = await mount(identifierStep);

    // On the host element itself.
    expect(getComputedStyle(element).getPropertyValue("--zl-color-text-primary-white")).toBe(
      HOST_RED,
    );
    // Boundary 1: chrome the orchestrator renders in its own shadow root.
    const title = element.shadowRoot?.querySelector(".zl-card-title") as HTMLElement;
    expect(title).toBeTruthy();
    expect(getComputedStyle(title).color).toBe(HOST_RED);
    // Boundary 2: inside the atom's shadow root, where the token is consumed
    // by a stylesheet the host page cannot see or address.
    const field = element.shadowRoot?.querySelector("zl-field") as HTMLElement;
    const input = field.shadowRoot?.querySelector("input") as HTMLElement;
    expect(input).toBeTruthy();
    expect(getComputedStyle(input).color).toBe(HOST_RED);
  });

  it("the embedding app's CSS outranks the tenant's server-side branding", async () => {
    // The app owns its page: a first-party embed must be able to match its
    // own design system even when the tenant has brand colours configured.
    appStylesheet(`zitadel-login { --zl-color-text-primary-white: ${HOST_RED}; }`);
    const element = await mount(brandedStep);
    const title = element.shadowRoot?.querySelector(".zl-card-title") as HTMLElement;
    expect(getComputedStyle(title).color).toBe(HOST_RED);
  });

  it("the primary button consumes the --zl-primary pair from the host", async () => {
    // The semantic brand knob: setting the Figma `primary` pair on the host
    // element restyles the primary CTA through both shadow boundaries.
    const HOST_BLUE = "rgb(0, 0, 255)";
    appStylesheet(
      `zitadel-login { --zl-primary: ${HOST_RED}; --zl-primary-foreground: ${HOST_BLUE}; }`,
    );
    const element = await mount(identifierStep);
    const atom = element.shadowRoot?.querySelector("zl-button") as HTMLElement;
    expect(atom).toBeTruthy();
    const button = atom.shadowRoot?.querySelector(".zr-btn--primary") as HTMLElement;
    expect(button).toBeTruthy();
    expect(getComputedStyle(button).backgroundColor).toBe(HOST_RED);
    expect(getComputedStyle(button).color).toBe(HOST_BLUE);
  });

  it("legacy primary-token overrides from the host keep working", async () => {
    // Upgrade path: embedders who override the documented legacy pair must
    // not silently get the stock CTA — the design-tokens sheet emits the
    // legacy names as aliases of `--zl-primary`, and a host override of the
    // legacy name beats that alias.
    const HOST_BLUE = "rgb(0, 0, 255)";
    appStylesheet(
      `zitadel-login {
        --zl-color-surface-default-white: ${HOST_RED};
        --zl-color-text-button-default: ${HOST_BLUE};
      }`,
    );
    const element = await mount(identifierStep);
    const atom = element.shadowRoot?.querySelector("zl-button") as HTMLElement;
    const button = atom.shadowRoot?.querySelector(".zr-btn--primary") as HTMLElement;
    expect(button).toBeTruthy();
    expect(getComputedStyle(button).backgroundColor).toBe(HOST_RED);
    expect(getComputedStyle(button).color).toBe(HOST_BLUE);
  });

  it("suppress-header collapses the card's header region, not just the text", async () => {
    // The headings going sr-only is not enough: the card's flex layout kept
    // a blank 32px header band while the header slot stayed assigned. The
    // stamped attribute pulls the header region out of the flow.
    const plain = await mount(identifierStep);
    const plainCard = plain.shadowRoot?.querySelector("zl-card") as HTMLElement;
    const plainHeight = plainCard.getBoundingClientRect().height;
    plain.remove();
    stub?.restore();

    const suppressed = await mount(identifierStep, (el) => {
      el.suppressHeader = true;
    });
    const suppressedCard = suppressed.shadowRoot?.querySelector("zl-card") as HTMLElement;
    const suppressedHeight = suppressedCard.getBoundingClientRect().height;
    // Title (2rem line) + the 32px header/body gap must be gone — well over
    // 40px shorter, not merely equal.
    expect(suppressedHeight).toBeLessThan(plainHeight - 40);
  });

  it("tenant palette.link recolors card links and nothing else", async () => {
    // Regression for the broken bridge: `palette.link` used to target the
    // pill token while the links kept a hard-coded purple accent.
    const linkedStep = {
      ...identifierStep,
      step: {
        ...identifierStep.step,
        actions: [
          ...identifierStep.step.actions,
          { name: "register", kind: "navigate", text_key: "identifier.action.register.link" },
        ],
      },
      branding: { palette: { link: "#ff0000" } },
    } as unknown as CreateFlow201;
    const element = await mount(linkedStep);
    const link = element.shadowRoot?.querySelector(".zl-card-nav__link") as HTMLElement;
    expect(link).toBeTruthy();
    expect(getComputedStyle(link).color).toBe(HOST_RED);
  });

  it("suppress-header hides the card heading visually but keeps it accessible", async () => {
    const element = await mount(identifierStep, (el) => {
      el.suppressHeader = true;
    });
    // Reflected on the host and stamped onto the template shell, so the
    // CSS covers user-ejected templates too.
    expect(element.hasAttribute("suppress-header")).toBe(true);
    const shell = element.shadowRoot?.querySelector("zl-page-shell") as HTMLElement;
    expect(shell.hasAttribute("data-suppress-header")).toBe(true);
    const title = element.shadowRoot?.querySelector(".zl-card-title") as HTMLElement;
    expect(title).toBeTruthy();
    expect(title.textContent?.trim()).not.toBe("");
    // Screen-reader-only, not display:none.
    const style = getComputedStyle(title);
    expect(style.position).toBe("absolute");
    expect(style.width).toBe("1px");
    expect(style.display).not.toBe("none");
  });

  it("the host page owns placement, width, and flow position", async () => {
    // A widget must lay out as a normal block in its parent — no viewport
    // claim, no breaking out of the container, no forced width.
    host.style.cssText = "display: flex; justify-content: flex-end; width: 900px;";
    appStylesheet(`zitadel-login { width: 380px; margin-top: 24px; }`);
    const element = await mount(identifierStep);

    const rect = element.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    expect(rect.width).toBe(380);
    // Right-aligned by the host's flexbox, not stretched across it.
    expect(Math.round(rect.right)).toBe(Math.round(hostRect.right));
    expect(rect.height).toBeLessThan(window.innerHeight);
  });

  it("locales override copy without forking the template", async () => {
    const element = await mount(identifierStep, (el) => {
      el.lang = "en";
      el.locales = { en: { "identifier.title": "Welcome back to Acme" } };
    });
    const title = element.shadowRoot?.querySelector(".zl-card-title") as HTMLElement;
    expect(title.textContent?.trim()).toBe("Welcome back to Acme");
  });

  it("emits flow events the host app can drive its own UI from", async () => {
    const steps: string[] = [];
    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.addEventListener("zitadel-flow-step", (event) => {
      steps.push((event as CustomEvent<{ step: { name: string } }>).detail.step.name);
    });
    stub = installFlowFetchStub(identifierStep);
    element.purpose = "login";
    element.project = project;
    host.appendChild(element);
    await waitFor(() => (element.shadowRoot?.querySelector("zl-field") ? element : null));
    expect(steps).toContain("identifier");
  });
});

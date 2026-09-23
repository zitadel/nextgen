import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "./zl-sso-providers.js";
import type { ZlSsoProviders, ZlSsoSelectDetail } from "./zl-sso-providers.js";

const GOOGLE = { id: "idp_google_1", name: "Google", template: "google" };
const GITHUB = { id: "idp_github_1", name: "GitHub", template: "github" };
const PRIVATE = { id: "idp_acme_1", name: "Acme SSO", template: "oidc-generic" };

/**
 * Markup and event behaviour for `<zl-sso-providers>` in jsdom. The atom owns
 * no form value and no focus delegation of its own — both belong to the
 * `<zl-button>` it composes — so there is no browser-only counterpart.
 */
describe("<zl-sso-providers>", () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  async function mount(providers: unknown, attrs = ""): Promise<ZlSsoProviders> {
    host.innerHTML = `<zl-sso-providers providers='${JSON.stringify(providers)}' ${attrs}></zl-sso-providers>`;
    const atom = host.querySelector("zl-sso-providers") as ZlSsoProviders;
    await atom.updateComplete;
    return atom;
  }

  function buttons(atom: ZlSsoProviders): HTMLElement[] {
    return Array.from(atom.shadowRoot?.querySelectorAll("zl-button") ?? []);
  }

  it("renders one button per provider, in the order given", async () => {
    const atom = await mount([GOOGLE, GITHUB]);

    expect(buttons(atom).map((b) => b.getAttribute("data-provider"))).toEqual([
      GOOGLE.id,
      GITHUB.id,
    ]);
  });

  it("labels each button with the vendor's name in the given format", async () => {
    const atom = await mount([GOOGLE], `label-format="Weiter mit {name}"`);

    expect(buttons(atom)[0]?.getAttribute("label")).toBe("Weiter mit Google");
  });

  it("shows the mark for a template that has one", async () => {
    const atom = await mount([GOOGLE]);

    const icon = atom.shadowRoot?.querySelector("zl-icon");
    expect(icon?.getAttribute("name")).toBe("brand-google");
  });

  it("still renders a working button for a template with no mark", async () => {
    // A tenant's own OIDC connection will never have artwork here, and a
    // stand-in glyph would be a wrong logo.
    const atom = await mount([PRIVATE]);

    expect(buttons(atom)).toHaveLength(1);
    expect(atom.shadowRoot?.querySelector("zl-icon")).toBeNull();
    expect(buttons(atom)[0]?.getAttribute("label")).toBe("Continue with Acme SSO");
  });

  it("emits zl-sso-select with the connection id when a button is chosen", async () => {
    const atom = await mount([GOOGLE, GITHUB]);
    const seen: ZlSsoSelectDetail[] = [];
    atom.addEventListener("zl-sso-select", (event) => {
      seen.push((event as CustomEvent<ZlSsoSelectDetail>).detail);
    });

    buttons(atom)[1]?.click();

    expect(seen).toEqual([{ providerId: GITHUB.id, template: "github", name: "GitHub" }]);
  });

  it("bubbles the event across the shadow boundary so the orchestrator hears it", async () => {
    const atom = await mount([GOOGLE]);
    const listener = vi.fn();
    document.addEventListener("zl-sso-select", listener);

    buttons(atom)[0]?.click();

    expect(listener).toHaveBeenCalledOnce();
    document.removeEventListener("zl-sso-select", listener);
  });

  it("does not let the inner button's zl-submit escape", async () => {
    // `<zl-button>` announces every click as `zl-submit`. If that reached the
    // orchestrator it would submit the step with the wrong action — which is
    // exactly what happened before this was caught: the server answered
    // `error.email_required` instead of redirecting to the provider.
    const atom = await mount([GOOGLE]);
    const escaped = vi.fn();
    document.addEventListener("zl-submit", escaped);

    buttons(atom)[0]?.click();

    expect(escaped).not.toHaveBeenCalled();
    document.removeEventListener("zl-submit", escaped);
  });

  it("holds the chosen button and disables the rest while the redirect is in flight", async () => {
    const atom = await mount([GOOGLE, GITHUB]);

    buttons(atom)[0]?.click();
    await atom.updateComplete;

    expect(buttons(atom)[0]?.hasAttribute("loading")).toBe(true);
    expect(buttons(atom)[1]?.hasAttribute("disabled")).toBe(true);
  });

  it("ignores a second click while a redirect is already in flight", async () => {
    const atom = await mount([GOOGLE]);
    const listener = vi.fn();
    atom.addEventListener("zl-sso-select", listener);

    buttons(atom)[0]?.click();
    await atom.updateComplete;
    buttons(atom)[0]?.click();

    expect(listener).toHaveBeenCalledOnce();
  });

  it("releases the buttons on reset, so a failed submit is recoverable", async () => {
    const atom = await mount([GOOGLE, GITHUB]);
    buttons(atom)[0]?.click();
    await atom.updateComplete;

    atom.reset();
    await atom.updateComplete;

    expect(buttons(atom)[0]?.hasAttribute("loading")).toBe(false);
    expect(buttons(atom)[1]?.hasAttribute("disabled")).toBe(false);
    const listener = vi.fn();
    atom.addEventListener("zl-sso-select", listener);
    buttons(atom)[1]?.click();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("disables every button while the step is submitting", async () => {
    const atom = await mount([GOOGLE, GITHUB], "disabled");

    expect(buttons(atom).every((b) => b.hasAttribute("disabled"))).toBe(true);
  });

  it("emits nothing when disabled", async () => {
    const atom = await mount([GOOGLE], "disabled");
    const listener = vi.fn();
    atom.addEventListener("zl-sso-select", listener);

    buttons(atom)[0]?.click();

    expect(listener).not.toHaveBeenCalled();
  });

  it("renders the divider only when one is asked for", async () => {
    const without = await mount([GOOGLE]);
    expect(without.shadowRoot?.querySelector(".zr-sso__divider")).toBeNull();

    const with_ = await mount([GOOGLE], `divider-label="or"`);
    expect(with_.shadowRoot?.querySelector(".zr-sso__divider")?.textContent?.trim()).toBe("or");
  });

  it("renders nothing at all when the step offers no providers", async () => {
    const atom = await mount([], `divider-label="or"`);

    expect(atom.shadowRoot?.querySelector(".zr-sso")).toBeNull();
  });

  it("survives a malformed providers payload rather than taking the screen down", async () => {
    host.innerHTML = `<zl-sso-providers providers='{not json'></zl-sso-providers>`;
    const atom = host.querySelector("zl-sso-providers") as ZlSsoProviders;
    await atom.updateComplete;

    expect(atom.providers).toEqual([]);
    expect(atom.shadowRoot?.querySelector(".zr-sso")).toBeNull();
  });

  it("drops entries that could not be submitted or shown", async () => {
    const atom = await mount([GOOGLE, { id: "", name: "No id" }, { id: "x", name: "" }]);

    expect(buttons(atom)).toHaveLength(1);
  });
});

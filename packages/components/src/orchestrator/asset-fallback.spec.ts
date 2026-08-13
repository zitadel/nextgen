/**
 * Broken-branding-asset degradation, exercised over the *shipped* split
 * template rather than hand-written markup: the regression this guards is
 * that `.zl-split__placeholder` is keyed on "no asset configured", so a
 * configured-but-dead asset used to leave the brand pane empty (a 0×0 img,
 * no console error, nothing in plan output).
 *
 * jsdom never loads images, so failure is injected the way the browser
 * reports it — an `error` event on the element.
 */
import type { CreateFlow201Step } from "@zitadel/api/generated/model";
import { getDefaultBrandingConfig } from "@zitadel/config/defaults";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { armAssetFallbacks } from "./asset-fallback.js";
import { createLiquidEngine } from "./liquid.js";
import { createSanitiser } from "./sanitiser.js";

const locale: Record<string, string> = {
  "identifier.title": "Sign in",
  "identifier.field.email": "Work email",
  "submit.continue": "Continue",
};

const step: CreateFlow201Step = {
  name: "identifier",
  fields: [{ name: "email", type: "email", text_key: "identifier.field.email", required: true }],
  actions: [{ name: "submit", kind: "submit", text_key: "submit.continue", primary: true }],
  gates: {},
};

function render(design: string, branding: Record<string, string>): HTMLElement {
  const { template } = getDefaultBrandingConfig(design);
  const html = createLiquidEngine({ locale }).parseAndRenderSync(template, {
    step: { name: step.name, texts: { title_key: "identifier.title" } },
    fields: step.fields,
    actions: step.actions,
    gates: [],
    messages: [],
    errors: [],
    identity: null,
    branding,
    loading: false,
    challenge: null,
  });
  const root = document.createElement("div");
  root.innerHTML = createSanitiser()(html);
  document.body.append(root);
  return root;
}

function fail(img: Element): void {
  img.dispatchEvent(new Event("error"));
}

beforeEach(() => {
  // Silenced, not asserted away: one test below checks it was called.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("armAssetFallbacks", () => {
  it("hides a broken logo and restores the split placeholder", () => {
    const root = render("split", { logo_url: "https://cdn.example.com/gone.svg" });
    const pane = root.querySelector(".zl-split__brand") as HTMLElement;
    expect(pane.querySelector(".zl-split__placeholder")).toBeNull();

    armAssetFallbacks(root);
    for (const img of root.querySelectorAll("img")) {
      fail(img);
    }

    const logo = pane.querySelector("img.zl-split__logo") as HTMLElement;
    expect(logo.hasAttribute("data-zl-asset-broken")).toBe(true);
    const placeholder = pane.querySelector(".zl-split__placeholder");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute("aria-hidden")).toBe("true");
  });

  it("says out loud what it hid — the failure is silent everywhere else", () => {
    const root = render("split", { logo_url: "https://cdn.example.com/gone.svg" });
    armAssetFallbacks(root);

    fail(root.querySelector("img.zl-split__logo") as Element);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("https://cdn.example.com/gone.svg"),
    );
  });

  it("leaves the pane alone while one asset still renders", () => {
    const root = render("split", {
      logo_url: "https://cdn.example.com/gone.svg",
      hero_url: "https://cdn.example.com/hero.png",
    });
    const pane = root.querySelector(".zl-split__brand") as HTMLElement;

    armAssetFallbacks(root);
    fail(pane.querySelector("img.zl-split__logo") as Element);

    expect(pane.querySelector(".zl-split__placeholder")).toBeNull();
    expect((pane.querySelector("img.zl-split__hero") as Element).hasAttribute(
      "data-zl-asset-broken",
    )).toBe(false);
  });

  it("does not decorate a brand pane whose non-image content still renders", () => {
    // The hero design fills the pane with a landing mock; a dead logo inside
    // it is a missing wordmark, not an empty pane.
    const root = render("hero", { logo_url: "https://cdn.example.com/gone.svg" });
    const pane = root.querySelector(".zl-split__brand") as HTMLElement;

    armAssetFallbacks(root);
    for (const img of pane.querySelectorAll("img")) {
      fail(img);
    }

    expect(pane.querySelector(".zl-split__placeholder")).toBeNull();
  });

  it("adds exactly one placeholder however often it is called", () => {
    const root = render("split-right", { hero_url: "https://cdn.example.com/gone.png" });
    const pane = root.querySelector(".zl-split__brand") as HTMLElement;

    armAssetFallbacks(root);
    fail(pane.querySelector("img.zl-split__hero") as Element);
    armAssetFallbacks(root);
    armAssetFallbacks(root);

    expect(pane.querySelectorAll(".zl-split__placeholder")).toHaveLength(1);
  });

  it("arms each image once, so a re-commit does not stack listeners", () => {
    const root = render("split", { logo_url: "https://cdn.example.com/gone.svg" });
    const img = root.querySelector("img.zl-split__logo") as HTMLImageElement;
    const addListener = vi.spyOn(img, "addEventListener");

    armAssetFallbacks(root);
    armAssetFallbacks(root);

    expect(addListener).toHaveBeenCalledTimes(1);
  });

  it("catches an image that already failed before it was armed", () => {
    const root = render("split", { logo_url: "https://cdn.example.com/gone.svg" });
    const img = root.querySelector("img.zl-split__logo") as HTMLImageElement;
    // jsdom never loads, so `complete`/`naturalWidth` are stubbed to the
    // shape a browser reports for an image whose error already fired.
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 0 });

    armAssetFallbacks(root);

    expect(img.hasAttribute("data-zl-asset-broken")).toBe(true);
    expect(root.querySelector(".zl-split__placeholder")).not.toBeNull();
  });

  it("leaves a healthy design untouched", () => {
    const root = render("split", { logo_url: "https://cdn.example.com/logo.svg" });

    armAssetFallbacks(root);

    expect(root.querySelector("[data-zl-asset-broken]")).toBeNull();
    expect(root.querySelector(".zl-split__placeholder")).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });
});

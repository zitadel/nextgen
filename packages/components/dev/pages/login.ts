/**
 * `<zitadel-login>` playground page.
 *
 * Mounts the orchestrator, wires MSW-intercepted API calls, and coordinates:
 *
 * - `login.html`          — shell markup
 * - `login.css`           — scoped styles
 * - `login-inspector.ts`  — branding / template editor / API response viewer
 */
import { applyBranding } from "@zitadel-nextgen/api-mock";

import type { ZitadelLogin } from "../../src/orchestrator/index.js";
import { brandingPresets, type BrandingPresetId } from "../branding-presets.js";

import "./login.css";
import shellHtml from "./login.html?raw";
import { initInspector } from "./login-inspector.js";

const PRESET_LABEL: Record<BrandingPresetId, string> = {
  centered: "Centered (light)",
  split: "Split (light)",
  dark: "Centered (dark)",
};

export function renderLoginPage(host: HTMLElement): void {
  // ── Render shell ──
  const presetOptions = (Object.keys(brandingPresets) as BrandingPresetId[])
    .map((id) => `<option value="${id}">${PRESET_LABEL[id]}</option>`)
    .join("");

  host.innerHTML = shellHtml.replace("{{PRESET_OPTIONS}}", presetOptions);

  // ── DOM refs ──
  const frame = host.querySelector<HTMLElement>("#frame")!;
  const resetButton = host.querySelector<HTMLButtonElement>("#reset")!;
  const purposeButtons = host.querySelectorAll<HTMLButtonElement>(".pg-purpose-btn");

  // ── State ──
  let currentPurpose: "login" | "register" = "login";
  let currentPreset: BrandingPresetId = "centered";
  let customTemplate: string | null = null;

  // ── Inspector setup ──
  const { updateFlowResponse, logEvent } = initInspector(host, {
    onBrandingChange(presetId) {
      currentPreset = presetId as BrandingPresetId;
      mount();
    },
    onTemplateChange(template) {
      customTemplate = template;
      mount();
    },
  });

  // ── Purpose toggle ──
  purposeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      purposeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentPurpose = btn.dataset.purpose as "login" | "register";
      mount();
    });
  });

  // ── Widget mount ──
  function mount(): void {
    const branding = {
      ...brandingPresets[currentPreset],
      ...(customTemplate ? { liquid_template: customTemplate } : {}),
    };
    applyBranding(branding);
    frame.innerHTML = "";

    const element = document.createElement("zitadel-login") as ZitadelLogin;
    element.purpose = currentPurpose;
    element.projectId = "dev-playground";

    element.addEventListener("zitadel-flow-input", (e) =>
      logEvent("flow-input", (e as CustomEvent).detail),
    );
    element.addEventListener("zitadel-flow-action", (e) =>
      logEvent("flow-action", (e as CustomEvent).detail),
    );
    element.addEventListener("zitadel-flow-step", (e) => {
      const d = (e as CustomEvent).detail;
      logEvent("flow-step", { step: d.step?.name });
      updateFlowResponse(d);
    });
    element.addEventListener("zitadel-flow-complete", (e) => {
      const d = (e as CustomEvent).detail;
      logEvent("flow-complete", d);
      updateFlowResponse(d);
    });
    element.addEventListener("zitadel-flow-error", (e) =>
      logEvent("flow-error", (e as CustomEvent).detail),
    );

    frame.appendChild(element);
  }

  // ── Restart ──
  resetButton.addEventListener("click", mount);

  mount();
}

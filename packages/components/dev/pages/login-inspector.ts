/**
 * Inspector panel controller for the playground's right-hand panel.
 *
 * Manages three tabs:
 * - Branding: preset selector
 * - Template: live Liquid template editor with Apply / Reset
 * - API: initial flow response + current step response
 */
import { authFormTemplate } from "../../src/orchestrator/templates/auth-form.liquid.js";

export type InspectorCallbacks = {
  /** Called when a custom template is applied or reset. */
  onTemplateChange: (customTemplate: string | null) => void;
  /** Called when the branding preset changes. */
  onBrandingChange: (presetId: string) => void;
};

/**
 * Wire the inspector panel: tab switching, template editing, branding
 * changes, and flow response display.
 */
export function initInspector(
  root: HTMLElement,
  callbacks: InspectorCallbacks,
): {
  updateFlowResponse: (detail: unknown) => void;
  logEvent: (name: string, detail: unknown) => void;
} {
  const templateEditor = root.querySelector<HTMLTextAreaElement>("#template-editor")!;
  const applyBtn = root.querySelector<HTMLButtonElement>("#apply-template")!;
  const resetTplBtn = root.querySelector<HTMLButtonElement>("#reset-template")!;
  const statusEl = root.querySelector<HTMLSpanElement>("#template-status")!;
  const presetSelect = root.querySelector<HTMLSelectElement>("#preset")!;
  const flowResponseEl = root.querySelector<HTMLTextAreaElement>("#flow-response")!;
  const eventsEl = root.querySelector<HTMLPreElement>("#events")!;

  const bundledTemplate = authFormTemplate;
  let customTemplate: string | null = null;

  // ── Seed editor ──
  templateEditor.value = bundledTemplate;

  // ── Tab switching ──
  root.querySelectorAll<HTMLButtonElement>(".pg-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      root
        .querySelectorAll<HTMLButtonElement>(".pg-tab")
        .forEach((t) => t.classList.remove("active"));
      root
        .querySelectorAll<HTMLElement>(".pg-pane")
        .forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      root
        .querySelector<HTMLElement>(`#${tab.dataset.pane}`)
        ?.classList.add("active");
    });
  });

  // ── Branding preset ──
  presetSelect.addEventListener("change", () => {
    callbacks.onBrandingChange(presetSelect.value);
  });

  // ── Apply / Reset template ──
  applyBtn.addEventListener("click", () => {
    const value = templateEditor.value.trim();
    if (value === bundledTemplate.trim()) {
      customTemplate = null;
      statusEl.textContent = "bundled default";
      statusEl.classList.remove("applied");
    } else {
      customTemplate = value;
      statusEl.textContent = "custom applied ✓";
      statusEl.classList.add("applied");
    }
    callbacks.onTemplateChange(customTemplate);
  });

  resetTplBtn.addEventListener("click", () => {
    customTemplate = null;
    templateEditor.value = bundledTemplate;
    statusEl.textContent = "bundled default";
    statusEl.classList.remove("applied");
    callbacks.onTemplateChange(null);
  });

  // ── Tab key inserts two spaces ──
  templateEditor.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const s = templateEditor.selectionStart;
      const end = templateEditor.selectionEnd;
      templateEditor.value =
        templateEditor.value.substring(0, s) +
        "  " +
        templateEditor.value.substring(end);
      templateEditor.selectionStart = templateEditor.selectionEnd = s + 2;
    }
  });

  // ── Public API ──
  return {
    updateFlowResponse(detail: unknown): void {
      flowResponseEl.value = JSON.stringify(detail, null, 2);
    },
    logEvent(name: string, detail: unknown): void {
      const time = new Date().toLocaleTimeString();
      eventsEl.textContent = `[${time}] ${name} ${JSON.stringify(detail)}\n${eventsEl.textContent}`;
    },
  };
}

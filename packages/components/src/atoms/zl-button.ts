import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

import buttonHost from "@zitadel/shared-component-styles/lit/button-host.css?inline";
import buttonSurface from "@zitadel/shared-component-styles/button.css?inline";

import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

import "./zl-icon.js";

/**
 * Atom: `<zl-button>` — the entire Figma button matrix in a single atom.
 *
 * Spec lineage (file `8UjCXw8yemgljmbkWGrSfE`, "Zitadel - Design System - External"):
 *   - master variant set: node `6598:292`
 *   - icon-leading instance reference: node `6598:143281` (passkey upsell)
 *
 * Variant axes (matches Figma directly):
 *   - hierarchy: primary | secondary | text
 *   - size:      medium (48 × auto) | small (40 × auto)
 *   - state:     enabled / hovered / focused / pressed / disabled
 *                (derived from interaction, not props)
 *   - slots:     `leading` icon, `trailing` icon, default for the label.
 *                When `loading` is set the trailing slot is replaced with a
 *                spinning ring (Figma shows the spinner trailing).
 *
 * Per-state Figma values (resolved from `figma.tokens.json` primitives):
 *
 *   Primary
 *     enabled        bg=#f4f4f6 (surface.default-white)     fg=#0f0f11   border=transparent
 *     hover/pressed  bg=#cfcfde (gray.600)                  fg=#0f0f11   border=1px #252528
 *     focus-visible  bg=#cfcfde + native outline ring
 *     disabled       bg=#f4f4f6                             fg=#686883 (text.disabled)
 *
 *   Secondary
 *     enabled        bg=#252528 (border.default-black)      fg=#f4f4f6 (text.button-invert)
 *     hover/pressed  bg=#484a57 (gray.200)                  fg=#f4f4f6
 *     focus-visible  bg=#252528 + native outline ring       fg=#f4f4f6
 *     disabled       bg=#252528                             fg=#686883
 *
 *   Text
 *     enabled        bg=transparent                         fg=#f4f4f6
 *     hover/pressed  bg=#484a57                             fg=#f4f4f6
 *     focus-visible  bg=#252528 + native outline ring       fg=#f4f4f6
 *     disabled       bg=transparent                         fg=#686883
 *
 *   Common
 *     padding        10px (block) / 16px (inline)            radius=8px
 *     gap            8px between icon/label/icon
 *     font           Arimo SemiBold (600)
 *                    medium: 16/24    small: 14/20
 *     icon          24px medium, 16px small
 *     focus ring    2px solid #f4f4f6, 2px offset
 *     transition    background-color / color / border-color, fast standard
 *
 * Form-associated so it can participate in the orchestrator's `<form>`
 * exactly like a native `<button>`. Setting `type="submit"` triggers
 * `form.requestSubmit()` on click; setting `type="reset"` calls
 * `form.reset()`. Otherwise the click event bubbles for SPA listeners.
 *
 * The atom always renders a real `<button>` inside the shadow root —
 * `delegatesFocus` ensures Tab lands on it and `<zl-field>`'s
 * Enter-to-submit pipe still fires the host form.
 */
@customElement("zl-button")
export class ZlButton extends LitElement {
  static formAssociated = true;

  static override shadowRootOptions: ShadowRootInit = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  static override styles = [
    baseHostStyles,
    ...surfaceStyles(buttonHost, buttonSurface),
  ];

  @property({ reflect: true }) accessor hierarchy: "primary" | "secondary" | "text" = "primary";

  @property({ reflect: true }) accessor size: "medium" | "small" = "medium";

  @property() accessor type: "button" | "submit" | "reset" = "button";

  @property() accessor action: string | undefined = undefined;

  @property({ type: Boolean }) accessor loading = false;

  @property({ type: Boolean, reflect: true }) accessor disabled = false;

  @property({ type: Boolean, reflect: true }) accessor block = false;

  @property() accessor label: string | undefined = undefined;

  private readonly internals: ElementInternals;

  constructor() {
    super();
    this.internals = this.attachInternals();
  }

  override focus(options?: FocusOptions): void {
    this.shadowRoot?.querySelector<HTMLButtonElement>("button")?.focus(options);
  }

  private surfaceClasses(): string {
    return [
      "root",
      "zr-btn",
      `zr-btn--${this.hierarchy}`,
      `zr-btn--${this.size}`,
      this.block ? "zr-btn--block" : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  override render() {
    const blocked = this.disabled || this.loading;
    const forcedState = this.getAttribute("data-state");
    // If `label` is provided, render the text directly and treat the default
    // slot as a fallback (avoids the whitespace-only slot bug where indentation
    // between `<zl-icon slot="leading">` tags marks the default slot as
    // "assigned" with text nodes, suppressing slot fallback content).
    const body = this.label !== undefined ? html`<span>${this.label}</span>` : html`<slot></slot>`;
    return html`
      <button
        class=${this.surfaceClasses()}
        part="root"
        type=${this.type}
        ?disabled=${blocked}
        aria-busy=${this.loading ? "true" : "false"}
        data-state=${forcedState ?? nothing}
        @click=${this.handleClick}
      >
        <slot name="leading"></slot>
        ${body}
        ${this.loading
          ? html`<span class="spinner" part="spinner"><zl-icon name="spinner" size=${this.size === "small" ? "16" : "24"} spin decorative></zl-icon></span>`
          : html`<slot name="trailing"></slot>`}
      </button>
    `;
  }

  private handleClick = (event: MouseEvent): void => {
    if (this.disabled || this.loading) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const form = this.internals.form;
    if (this.type === "submit" && form) {
      // Mirror native <button type="submit"> behaviour through the
      // shadow boundary so the host <form>'s validation runs.
      event.preventDefault();
      form.requestSubmit();
    } else if (this.type === "reset" && form) {
      event.preventDefault();
      form.reset();
    }
    this.dispatchEvent(
      new CustomEvent("zl-submit", {
        bubbles: true,
        composed: true,
        detail: { action: this.action ?? null },
      }),
    );
  };
}

export const zlButtonManifest: AtomManifest = {
  tag: "zl-button",
  consumes: { action: { kind: "submit", required: false } },
  attrs: ["hierarchy", "size", "type", "action", "loading", "disabled", "block", "label"],
  parts: ["root", "spinner"],
  slots: ["", "leading", "trailing"],
  events: ["zl-submit"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-button": ZlButton;
  }
}

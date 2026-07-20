import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import buttonHost from "@zitadel/shared-component-styles/lit/button-host.css?inline";
import buttonSurface from "@zitadel/shared-component-styles/button.css?inline";

import { emit } from "../internal/emit.js";
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

  @property({ attribute: "data-testid" }) accessor testId: string | undefined = undefined;

  /**
   * Forces a visual interaction state on the inner button, projected to its
   * `data-state` attribute. Used by the design playground to capture
   * hover/pressed/focus states; reactive so toggling the host attribute
   * re-renders.
   */
  @property({ attribute: "data-state" }) accessor forcedState: string | null = null;

  private readonly internals: ElementInternals;

  constructor() {
    super();
    this.internals = this.attachInternals();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("click", this.handleHostClick);
  }

  override disconnectedCallback(): void {
    this.removeEventListener("click", this.handleHostClick);
    super.disconnectedCallback();
  }

  override focus(options?: FocusOptions): void {
    this.shadowRoot?.querySelector<HTMLButtonElement>("button")?.focus(options);
  }

  override render() {
    const hierarchy = this.stringOption("hierarchy", this.hierarchy, "primary");
    const size = this.stringOption("size", this.size, "medium");
    const type = this.buttonType();
    const loading = this.booleanOption("loading", this.loading);
    const disabled = this.booleanOption("disabled", this.disabled);
    const block = this.booleanOption("block", this.block);
    const label = this.stringOption("label", this.label);
    const blocked = disabled || loading;
    // If `label` is provided, render the text directly and treat the default
    // slot as a fallback (avoids the whitespace-only slot bug where indentation
    // between `<zl-icon slot="leading">` tags marks the default slot as
    // "assigned" with text nodes, suppressing slot fallback content).
    const body = label !== undefined ? html`<span>${label}</span>` : html`<slot></slot>`;
    return html`
      <button
        class=${classMap({
          root: true,
          "zr-btn": true,
          [`zr-btn--${hierarchy}`]: true,
          [`zr-btn--${size}`]: true,
          "zr-btn--block": block,
        })}
        part="root"
        type=${type}
        ?disabled=${blocked}
        aria-busy=${loading ? "true" : "false"}
        data-testid=${this.nativeButtonTestId() ?? nothing}
        data-state=${this.forcedState ?? nothing}
        @click=${this.handleClick}
      >
        <slot name="leading"></slot>
        ${body}
        ${loading
          ? html`<span class="spinner" part="spinner"><zl-icon name="spinner" size=${size === "small" ? "16" : "24"} spin decorative></zl-icon></span>`
          : html`<slot name="trailing"></slot>`}
      </button>
    `;
  }

  private handleClick = (event: MouseEvent): void => {
    this.activate(event);
  };

  private handleHostClick = (event: MouseEvent): void => {
    if (event.composedPath()[0] !== this) return;
    this.activate(event);
  };

  private nativeButtonTestId(): string | undefined {
    const testId = this.stringOption("data-testid", this.testId);
    if (testId) {
      return `${testId}-button`;
    }
    const action = this.buttonAction();
    return action ? `zitadel-action-${action}` : undefined;
  }

  private buttonType(): "button" | "submit" | "reset" {
    const type = this.stringOption("type", this.type, "button");
    return type === "submit" || type === "reset" ? type : "button";
  }

  private buttonAction(): string | undefined {
    return this.stringOption("action", this.action);
  }

  private activate(event: MouseEvent): void {
    const type = this.buttonType();
    const action = this.buttonAction();
    if (this.booleanOption("disabled", this.disabled) || this.booleanOption("loading", this.loading)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    const form = this.internals.form;
    if (type === "submit" && form) {
      // Mirror native <button type="submit"> through the shadow boundary:
      // delegate to the host <form> so its `submit` event is the single
      // submission signal. On a generic form this runs native constraint
      // validation; inside <zitadel-login> the form is `novalidate`, so the
      // orchestrator's `missingRequiredFields` gate enforces instead. Emitting
      // `zl-submit` too would bypass the form handler, so we don't (the
      // Enter-to-submit path in <zl-field> likewise relies on the form `submit`
      // event alone). Non-submit and form-less buttons still emit `zl-submit`
      // below for SPA/orchestrator listeners.
      event.preventDefault();
      form.requestSubmit();
      return;
    }
    if (type === "reset" && form) {
      event.preventDefault();
      form.reset();
    }
    emit<{ action: string | null }>(this, "zl-submit", { action: action ?? null });
  }

  private stringOption(
    attribute: string,
    value: string | null | undefined,
    fallback?: string,
  ): string | undefined {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
    const attr = this.getAttribute(attribute);
    if (attr !== null && attr.length > 0) {
      return attr;
    }
    return fallback;
  }

  private booleanOption(attribute: string, value: boolean): boolean {
    return value === true || this.hasAttribute(attribute);
  }
}

export const zlButtonManifest: AtomManifest = {
  tag: "zl-button",
  consumes: { action: { kind: "submit", required: false } },
  attrs: ["hierarchy", "size", "type", "action", "loading", "disabled", "block", "label", "data-testid"],
  parts: ["root", "spinner"],
  slots: ["", "leading", "trailing"],
  events: ["zl-submit"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-button": ZlButton;
  }
}

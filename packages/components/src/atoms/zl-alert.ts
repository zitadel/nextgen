import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

import alertStyles from "./zl-alert.css?inline";

import { emit } from "../internal/emit.js";
import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

import "./zl-icon.js";
import type { IconName } from "./zl-icon.js";

/**
 * Atom: `<zl-alert>` — inline status message replacing the legacy
 * `<zl-error>`.
 *
 * Spec lineage (file `8UjCXw8yemgljmbkWGrSfE`):
 *   - design-system master: node `6593:2640` (Alert/Error). Screen instance
 *     `6596:132779` matches the same chrome. Severity is conveyed by icon
 *     shape and colour, not by tinting the background.
 *
 * Per-state Figma values:
 *
 *   Layout
 *     surface     bg surface.default-primary-gray (#252528), no border
 *     padding     16px (spacing-03)
 *     gap         16px between icon and content
 *     radius      12px (radius.m)
 *     shadow      0 1px 2px rgba(16,24,40,0.05) (shadow-xs)
 *
 *   Icon (16px)
 *     error       alert-circle, color text.error (#ea4f70)
 *     warning     alert-circle, color text.subtitle-orange (#f25543)
 *     success     check, color text.success (#33a779)
 *     info        info, color text.subtitle-gray (#bfbfcf)
 *
 *   Text
 *     heading     Arimo SemiBold 14/20, color text.button-invert (#f4f4f6)
 *     body        Arimo Regular 14/20, color text.button-invert
 *     gap (heading→body)  4px (spacing-01)
 *
 *   Close button (when dismissible)
 *     36 × 36 hit target, padding 8px, radius 8px (radius.s)
 *     icon `cross` at 20px, color text.secondary-gray
 *     placed at the end of the flex row (icon · content · close)
 *
 * Templates render one per step when the flow returns errors; the
 * orchestrator surfaces flow-level errors through `errors` in the Liquid
 * context.
 */
@customElement("zl-alert")
export class ZlAlert extends LitElement {
  static override styles = [
    baseHostStyles,
    ...surfaceStyles(alertStyles),
  ];

  @property({ reflect: true }) accessor severity: "error" | "success" | "warning" | "info" = "error";

  @property() accessor heading: string | undefined = undefined;

  @property({ type: Boolean, reflect: true }) accessor dismissible = false;

  override render() {
    const iconName = ICON_FOR_SEVERITY[this.severity];
    return html`
      <div
        class="zr-alert zr-alert--${this.severity}"
        part="alert"
        role=${this.severity === "error" ? "alert" : "status"}
        aria-live=${this.severity === "error" ? "assertive" : "polite"}
      >
        <zl-icon class="zr-alert__icon" part="icon" name=${iconName} size="16" decorative></zl-icon>
        <div class="zr-alert__body" part="body">
          ${this.heading ? html`<span class="zr-alert__title" part="title">${this.heading}</span>` : null}
          <div class="zr-alert__message" part="message">
            <slot></slot>
          </div>
        </div>
        ${this.dismissible
          ? html`<button
              type="button"
              class="zr-alert__close"
              part="close"
              aria-label="Dismiss"
              @click=${this.handleDismiss}
            >
              <zl-icon name="cross" size="16" label="Dismiss" decorative></zl-icon>
            </button>`
          : null}
      </div>
    `;
  }

  private handleDismiss = (): void => {
    emit(this, "zl-dismiss");
    this.remove();
  };
}

const ICON_FOR_SEVERITY: Record<NonNullable<ZlAlert["severity"]>, IconName> = {
  error: "alert-circle",
  warning: "alert-circle",
  success: "check",
  info: "info",
};

export const zlAlertManifest: AtomManifest = {
  tag: "zl-alert",
  attrs: ["severity", "heading", "dismissible"],
  parts: ["alert", "icon", "body", "title", "message", "close"],
  slots: [""],
  events: ["zl-dismiss"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-alert": ZlAlert;
  }
}

import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";

import alertStyles from "./zl-alert.css?inline";

import { emit } from "../internal/emit.js";
import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, sharedStyles, surfaceStyles } from "../styles/index.js";

import "./zl-icon.js";
import type { IconName } from "./zl-icon.js";

/**
 * Atom: `<zl-alert>` — inline status message replacing the legacy
 * `<zl-error>`.
 *
 * Severity is conveyed by icon shape and colour, not by tinting the
 * background.
 *
 * Templates render one per step when the flow returns errors; the
 * orchestrator surfaces flow-level errors through `errors` in the Liquid
 * context.
 */
@customElement("zl-alert")
export class ZlAlert extends LitElement {
  static override styles = [
    baseHostStyles,
    ...surfaceStyles(sharedStyles, alertStyles),
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
          <slot name="detail" class="zr-alert__detail" part="detail"></slot>
          <slot name="link" class="zr-alert__link" part="link"></slot>
        </div>
        ${this.dismissible
          ? html`<button
              type="button"
              class="zr-alert__close zr-focus-ring"
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
  parts: ["alert", "icon", "body", "title", "message", "detail", "link", "close"],
  slots: ["", "detail", "link"],
  events: ["zl-dismiss"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-alert": ZlAlert;
  }
}

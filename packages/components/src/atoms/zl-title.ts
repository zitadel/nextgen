import { css, html, LitElement, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";

import { emit } from "../internal/emit.js";
import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, focusVisibleStyles } from "../styles/index.js";
import "./zl-icon.js";

/**
 * Atom: `<zl-title>` — the card heading, optionally carrying the step's
 * back affordance (ADR 022).
 *
 * Without `back-action` it renders a plain `<h1>` and is a drop-in
 * replacement for the previous `<h1 class="zl-card-title">` template
 * markup (typography inherits from the host, so chrome CSS keeps
 * styling the class).
 *
 * With `back-action` set (templates pass the step's `kind: "back"` action
 * name), hovering the title — or focusing the control — slides the heading
 * right and reveals a back chevron. Clicking it dispatches the standard
 * `zl-submit` CustomEvent with `detail.action`, so the orchestrator's
 * existing delegation submits it exactly like any other action; the
 * template forwards wire data and encodes no flow topology.
 *
 * Accessibility: the `<h1>` stays non-interactive; the chevron is a real
 * `<button>` labelled via `back-label` (the localized `text_key` of the
 * action). It participates in the tab order even while visually hidden and
 * reveals itself on `:focus-visible`. Motion is `transform`-only and
 * disabled under `prefers-reduced-motion`.
 */
@customElement("zl-title")
export class ZlTitle extends LitElement {
  static override styles = [
    baseHostStyles,
    css`
      :host {
        display: block;
      }
      .zr-title {
        position: relative;
        display: flex;
        align-items: center;
      }
      .zr-title__heading {
        margin: 0;
        font: inherit;
        color: inherit;
        letter-spacing: inherit;
        text-align: inherit;
        transform: translateX(0);
        transition: transform 160ms ease;
      }
      .zr-title__back {
        position: absolute;
        left: 0;
        top: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        padding: 0;
        border: 0;
        border-radius: var(--zl-radius-sm, 0.375rem);
        background: none;
        color: inherit;
        cursor: pointer;
        opacity: 0;
        transform: translate(-0.5rem, -50%);
        transition:
          opacity 160ms ease,
          transform 160ms ease;
      }
      :host(:hover) .zr-title__back,
      .zr-title__back:focus-visible {
        opacity: 1;
        transform: translate(0, -50%);
      }
      :host(:hover) .zr-title--backable .zr-title__heading,
      .zr-title--backable:has(.zr-title__back:focus-visible) .zr-title__heading {
        transform: translateX(2.5rem);
      }
      .zr-title__back:focus-visible {
        ${focusVisibleStyles}
      }
      @media (prefers-reduced-motion: reduce) {
        .zr-title__heading,
        .zr-title__back {
          transition: none;
        }
      }
    `,
  ];

  /**
   * Name of the step's `kind: "back"` action. Presence toggles the chevron;
   * the value is submitted verbatim (clients identify back by kind, the
   * name is pass-through — ADR 022).
   */
  @property({ attribute: "back-action" }) accessor backAction: string | undefined = undefined;

  /** Localized label for the chevron button (the action's `text_key`). */
  @property({ attribute: "back-label" }) accessor backLabel: string | undefined = undefined;

  private onBackClick(): void {
    if (!this.backAction) return;
    emit<{ action: string | null }>(this, "zl-submit", { action: this.backAction });
  }

  override render() {
    const backable = Boolean(this.backAction);
    const classes = classMap({ "zr-title": true, "zr-title--backable": backable });
    return html`<div class=${classes} part="title">
      ${backable
        ? html`<button
            class="zr-title__back"
            part="back"
            type="button"
            aria-label=${this.backLabel ?? "Back"}
            @click=${this.onBackClick}
          >
            <zl-icon name="arrow-left" size="24" decorative></zl-icon>
          </button>`
        : nothing}
      <h1 class="zr-title__heading" part="heading"><slot></slot></h1>
    </div>`;
  }
}

export const zlTitleManifest: AtomManifest = {
  tag: "zl-title",
  attrs: ["back-action", "back-label"],
  parts: ["title", "back", "heading"],
  slots: [""],
  events: ["zl-submit"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-title": ZlTitle;
  }
}

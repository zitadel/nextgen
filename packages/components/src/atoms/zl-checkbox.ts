import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";

import checkboxStyles from "./zl-checkbox.css?inline";

import { emit } from "../internal/emit.js";
import { nextUid } from "../internal/unique-id.js";
import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

import "./zl-icon.js";

/** Detail shape emitted by the `zl-change` event. */
export type ZlCheckboxChangeDetail = { name: string; checked: boolean; value: string };

/**
 * Atom: `<zl-checkbox>` — labelled checkbox bound to a boolean choice.
 *
 * Spec lineage (file `8UjCXw8yemgljmbkWGrSfE`, "Zitadel - Design System - External"):
 *   - bare master variant set:        node `4387:460` (Checkbox)
 *   - labelled master variant set:    node `6634:1868` (Checkbox / With Label)
 *
 * Figma models the checked state as the `style` variant (Outline = unchecked,
 * Filled = checked) and Hovered / Focused / Pressed as a 32px circular halo
 * behind the 16px box. Those map to real CSS pseudo-classes; only the optional
 * `data-state` preview hook forces a state for the design matrix.
 *
 *   Box       16px, 2px radius, 8px gap to label, Inter 14/20 label.
 *   Unchecked 1px border icon.default-white (#f4f4f6).
 *   Checked   filled icon.default-white with a dark check glyph.
 *   Hover     halo surface.default-primary-gray; edge/fill icon.default-gray.
 *   Focus/Pressed  halo + edge/fill surface.default-white.
 *   Disabled  edge/fill text.disabled (#686883), muted label, no halo.
 *
 * Form participation: `<zl-checkbox>` is a form-associated custom element, so
 * it submits its `value` only when checked, exactly like a native checkbox.
 */
@customElement("zl-checkbox")
export class ZlCheckbox extends LitElement {
  static formAssociated = true;

  static override shadowRootOptions: ShadowRootInit = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  static override styles = [
    baseHostStyles,
    ...surfaceStyles(checkboxStyles),
  ];

  /**
   * Field name — used as the key in form submission and in `zl-change` detail.
   * The browser owns a native `name` property on form-associated elements, so
   * we manage it manually to avoid a conflicting auto-generated accessor (see
   * `<zl-field>`).
   */
  get name(): string {
    return this.getAttribute("name") ?? "";
  }

  set name(value: string) {
    this.setAttribute("name", value);
  }

  @property() accessor label = "";
  @property() accessor value = "on";
  @property({ type: Boolean, reflect: true }) accessor checked = false;
  @property({ type: Boolean, reflect: true }) accessor disabled = false;
  @property({ type: Boolean }) accessor required = false;
  /**
   * Inline validation message shown under the control (empty = none). Set by
   * the orchestrator's template on a field error; display-only, mirroring
   * `<zl-field>` / `<zl-select>` so the flow router routes every field type
   * the same way. Submission gating lives in `<zitadel-login>`.
   */
  @property() accessor error = "";
  @property({ type: Boolean, reflect: true }) accessor invalid = false;
  @property({ attribute: "aria-label" }) accessor ariaLabelText: string | undefined = undefined;
  @property({ attribute: "data-testid" }) accessor testId: string | undefined = undefined;

  /**
   * Forces a visual interaction state on the box, projected to the root's
   * `data-state` attribute. Preview-only — used by the design matrix to
   * capture hover/focus/pressed without real pointer interaction.
   */
  @property({ attribute: "data-state" }) accessor forcedState: string | null = null;

  @query(".zr-checkbox__input") private accessor inputEl: HTMLInputElement | null = null;

  private readonly inputId = nextUid("zl-checkbox");
  private readonly internals: ElementInternals;
  private defaultChecked = false;

  constructor() {
    super();
    this.internals = this.attachInternals();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.defaultChecked = this.hasAttribute("checked");
    this.syncFormState();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("checked") || changed.has("required") || changed.has("value")) {
      this.syncFormState();
    }
  }

  formResetCallback(): void {
    this.checked = this.defaultChecked;
  }

  formStateRestoreCallback(state: string | null): void {
    this.checked = state === this.value;
  }

  override focus(options?: FocusOptions): void {
    this.inputEl?.focus(options);
  }

  /**
   * The string this control contributes to form submission — the uniform
   * read/write contract `<zitadel-login>` uses to capture and restore field
   * values without knowing each atom's internal shape. Like a native checkbox
   * this is the value token only when checked, empty otherwise; assigning it
   * back restores the checked state.
   */
  get formValue(): string {
    return this.checked ? this.value : "";
  }

  set formValue(value: string) {
    this.checked = value !== "";
  }

  override render() {
    const errorId = `${this.inputId}-error`;
    const showError = Boolean(this.error);
    const rootClass = classMap({
      "zr-checkbox": true,
      "zr-checkbox--invalid": this.invalid || showError,
      "zr-checkbox--disabled": this.disabled,
    });
    const labelText = this.label;
    return html`
      <div class="zr-checkbox-field" part="field">
        <label class=${rootClass} part="root" data-state=${this.forcedState ?? nothing}>
          <input
            class="zr-checkbox__input"
            part="input"
            id=${this.inputId}
            type="checkbox"
            name=${this.name || nothing}
            .checked=${live(this.checked)}
            value=${this.value}
            ?required=${this.required}
            ?disabled=${this.disabled}
            aria-label=${ifDefined(labelText ? undefined : this.ariaLabelText)}
            aria-invalid=${this.invalid || showError ? "true" : "false"}
            aria-describedby=${showError ? errorId : nothing}
            data-testid=${ifDefined(this.nativeInputTestId())}
            @change=${this.handleChange}
          />
          <span class="zr-checkbox__box" part="box">
            <span class="zr-checkbox__face" part="face">
              <zl-icon class="zr-checkbox__check" part="check" name="check" size="16" decorative></zl-icon>
            </span>
          </span>
          ${labelText
            ? html`<span class="zr-checkbox__label" part="label">${labelText}</span>`
            : html`<slot></slot>`}
        </label>
        <div
          class="zr-checkbox__error"
          part="error"
          id=${errorId}
          role="alert"
          ?hidden=${!showError}
        >
          ${this.error}
        </div>
      </div>
    `;
  }

  private handleChange = (event: Event): void => {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    this.checked = input.checked;
    this.syncFormState();
    emit<ZlCheckboxChangeDetail>(this, "zl-change", {
      name: this.name,
      checked: this.checked,
      value: this.value,
    });
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  };

  private syncFormState(): void {
    this.internals.setFormValue?.(this.checked ? this.value : null);
    if (this.required && !this.checked) {
      this.internals.setValidity?.({ valueMissing: true }, "Please check this box to continue.");
    } else {
      this.internals.setValidity?.({});
    }
  }

  private nativeInputTestId(): string | undefined {
    if (this.name) {
      return `zitadel-checkbox-${this.name}`;
    }
    if (this.testId) {
      return `${this.testId}-input`;
    }
    return undefined;
  }
}

export const zlCheckboxManifest: AtomManifest = {
  tag: "zl-checkbox",
  attrs: [
    "name",
    "label",
    "value",
    "checked",
    "disabled",
    "required",
    "error",
    "invalid",
    "aria-label",
    "data-testid",
  ],
  parts: ["field", "root", "input", "box", "face", "check", "label", "error"],
  slots: [""],
  events: ["zl-change"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-checkbox": ZlCheckbox;
  }
}

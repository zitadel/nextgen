import { html, nothing, type PropertyValues } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";

import checkboxStyles from "./zl-checkbox.css?inline";

import { emit } from "../internal/emit.js";
import { FormAtom } from "../internal/form-atom.js";
import { nextUid } from "../internal/unique-id.js";
import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, sharedStyles, surfaceStyles } from "../styles/index.js";

import "./zl-icon.js";

/** Detail shape emitted by the `zl-change` event. */
export type ZlCheckboxChangeDetail = { name: string; checked: boolean; value: string };

/**
 * Atom: `<zl-checkbox>` — labelled checkbox bound to a boolean choice.
 *
 * Checked is the real `:checked` input, and hover, focus and pressed are real
 * pseudo-classes drawn as a halo behind the box. The `data-state` hook forces
 * a state for stories only.
 *
 * Form participation: `<zl-checkbox>` is a form-associated custom element, so
 * it submits its `value` only when checked, exactly like a native checkbox.
 */
@customElement("zl-checkbox")
export class ZlCheckbox extends FormAtom {
  static override styles = [baseHostStyles, ...surfaceStyles(sharedStyles, checkboxStyles)];

  @property() accessor label = "";
  @property() accessor value = "on";
  @property({ type: Boolean, reflect: true }) accessor checked = false;
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

  /**
   * Forces a visual interaction state on the box, projected to the root's
   * `data-state` attribute. Stories only, not product API.
   */
  @property({ attribute: "data-state" }) accessor forcedState: string | null = null;

  @query(".zr-checkbox__input") private accessor inputEl: HTMLInputElement | null = null;

  private readonly inputId = nextUid("zl-checkbox");

  override connectedCallback(): void {
    super.connectedCallback();
    this.syncFormState();
  }

  /** Ticked in the markup contributes its value token, as it would on submit. */
  protected readDefaultFormValue(): string {
    return this.hasAttribute("checked") ? this.value : "";
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("checked") || changed.has("required") || changed.has("value")) {
      this.syncFormState();
    }
  }

  override focus(options?: FocusOptions): void {
    this.inputEl?.focus(options);
  }

  /**
   * Like a native checkbox this is the value token only when checked, empty
   * otherwise; assigning it back restores the checked state.
   */
  override get formValue(): string {
    return this.checked ? this.value : "";
  }

  override set formValue(value: string) {
    this.checked = value !== "";
  }

  override render() {
    const errorId = `${this.inputId}-error`;
    const showError = Boolean(this.error);
    const rootClass = classMap({
      "zr-checkbox": true,
      "zr-checkbox--invalid": this.invalid || showError,
      "zr-checkbox--disabled": this.isDisabled,
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
            ?disabled=${this.isDisabled}
            aria-label=${ifDefined(labelText ? undefined : this.ariaLabelText)}
            aria-invalid=${this.invalid || showError ? "true" : "false"}
            aria-describedby=${showError ? errorId : nothing}
            data-testid=${ifDefined(this.nativeTestId("checkbox", "input"))}
            @change=${this.handleChange}
          />
          <span class="zr-checkbox__box" part="box">
            <span class="zr-checkbox__face" part="face">
              <zl-icon class="zr-checkbox__check" part="check" name="check" size="16" decorative></zl-icon>
            </span>
          </span>
          ${
            labelText
              ? html`<span class="zr-checkbox__label" part="label">${labelText}</span>`
              : html`<slot></slot>`
          }
        </label>
        <div
          class="zr-checkbox__error zr-inline-error"
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
    this.dispatchNativeChange();
  };

  private syncFormState(): void {
    this.internals.setFormValue?.(this.checked ? this.value : null);
    if (this.required && !this.checked) {
      this.internals.setValidity?.({ valueMissing: true }, "Please check this box to continue.");
    } else {
      this.internals.setValidity?.({});
    }
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

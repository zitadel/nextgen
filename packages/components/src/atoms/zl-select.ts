import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";

import selectHost from "@zitadel/shared-component-styles/lit/select-host.css?inline";
import selectSurface from "@zitadel/shared-component-styles/select.css?inline";

import { emit } from "../internal/emit.js";
import { nextUid } from "../internal/unique-id.js";
import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

import "./zl-icon.js";

/** A single choice in a `<zl-select>` listbox. */
export interface ZlSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** Detail shape emitted by the `zl-change` event. */
export type ZlSelectChangeDetail = { name: string; value: string };

/**
 * Atom: `<zl-select>` — a select bound to a single choice.
 *
 * Spec lineage (file `8UjCXw8yemgljmbkWGrSfE`, "Zitadel - Design System - External"):
 *   - trigger + open/selected matrix:  node `4397:4816` (Dropdown)
 *   - option (Items) state matrix:      node `4397:4098` (Input text)
 *
 * Agent-first contract (see `packages/components/AGENTS.md` → "Input atoms expose
 * a real native control"): the operable, accessible, form-associated, and
 * automatable control is a real native `<select>`. Screen readers, keyboard
 * users, password managers, native form submission/validation, and automation
 * drivers (Playwright `selectOption`, the chrome-devtools accessibility
 * snapshot, the Codex in-app browser) all interact with that native element via
 * the stable `data-testid="zitadel-select-${name}"`.
 *
 * The Figma-styled trigger + popup (`.zr-select__trigger` / `.zr-select__listbox`)
 * are a pointer-only **visual** layer: they are `aria-hidden` and never in the
 * tab order, so they don't duplicate the native control in the accessibility
 * tree. A mouse user sees the styled popup; everyone else (keyboard, AT, agents)
 * uses the native `<select>` and its native popup. Both paths converge on
 * `value`, emit `zl-change`, and mirror `internals.setFormValue()`.
 */
@customElement("zl-select")
export class ZlSelect extends LitElement {
  static formAssociated = true;

  static override shadowRootOptions: ShadowRootInit = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  static override styles = [
    baseHostStyles,
    ...surfaceStyles(selectHost, selectSurface),
  ];

  /**
   * Field name — used as the key in form submission and in `zl-change` detail.
   * Managed manually to avoid clobbering the native form-associated `name`
   * accessor the browser owns (see `<zl-field>` / `<zl-checkbox>`).
   */
  get name(): string {
    return this.getAttribute("name") ?? "";
  }

  set name(value: string) {
    this.setAttribute("name", value);
  }

  @property() accessor label = "";
  @property() accessor value = "";
  @property() accessor placeholder = "Select…";
  /**
   * Listbox options. Accepts either a JS array (property binding, used by React
   * and Storybook) or a JSON string (the `options` attribute, used by the
   * orchestrator's Liquid template, which can only emit markup). Mirrors the
   * `<zl-passkey>` options contract.
   */
  @property({
    attribute: "options",
    converter: {
      fromAttribute(value: string | null): ZlSelectOption[] {
        if (!value) return [];
        try {
          const parsed: unknown = JSON.parse(value);
          return Array.isArray(parsed) ? (parsed as ZlSelectOption[]) : [];
        } catch {
          return [];
        }
      },
    },
  })
  accessor options: ZlSelectOption[] = [];
  @property({ type: Boolean }) accessor required = false;
  /**
   * Inline validation message shown under the control (empty = none). Set by
   * the orchestrator's template when the flow re-renders with a field error;
   * display-only — submission gating lives in `<zitadel-login>`, mirroring
   * `<zl-field>`'s `error` contract so the router treats every field type the
   * same way.
   */
  @property() accessor error = "";
  @property({ type: Boolean, reflect: true }) accessor invalid = false;
  @property({ type: Boolean, reflect: true }) accessor disabled = false;
  @property({ type: Boolean, reflect: true }) accessor open = false;
  @property({ attribute: "aria-label" }) accessor ariaLabelText: string | undefined = undefined;
  @property({ attribute: "data-testid" }) accessor testId: string | undefined = undefined;

  @state() private accessor activeValue: string | null = null;

  @query(".zr-select__native") private accessor nativeEl: HTMLSelectElement | null = null;

  private readonly baseId = nextUid("zl-select");
  private readonly internals: ElementInternals;
  private defaultValue = "";

  constructor() {
    super();
    this.internals = this.attachInternals();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Reset default mirrors native form controls: the initial `value` attribute,
    // not a property assigned later (see `<zl-checkbox>` reading `checked`).
    this.defaultValue = this.getAttribute("value") ?? "";
    this.syncFormState();
    document.addEventListener("pointerdown", this.handleDocumentPointerDown, true);
    document.addEventListener("keydown", this.handleDocumentKeydown, true);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
    document.removeEventListener("keydown", this.handleDocumentKeydown, true);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("value") || changed.has("required")) {
      this.syncFormState();
    }
    if (changed.has("disabled") && this.disabled) {
      this.open = false;
    }
  }

  formResetCallback(): void {
    this.value = this.defaultValue;
    this.open = false;
  }

  formStateRestoreCallback(state: string | null): void {
    this.value = state ?? "";
  }

  override focus(options?: FocusOptions): void {
    this.nativeEl?.focus(options);
  }

  /**
   * The string this control contributes to form submission — the uniform
   * read/write contract `<zitadel-login>` uses to capture and restore field
   * values without knowing each atom's internal shape. For a select that is
   * simply the chosen option's value (empty = nothing chosen).
   */
  get formValue(): string {
    return this.value;
  }

  set formValue(value: string) {
    this.value = value;
  }

  /**
   * Options as painted in the listbox: a leading empty row (labelled with the
   * placeholder) so the user can return to "no selection". For a `required`
   * field this empty row is the prompt — choosing it leaves the value empty,
   * so `required` validation still blocks submit (native `<select>`
   * semantics). Any empty-valued member of the caller's list is dropped first,
   * so a schema enum that lists "" doesn't render a second, duplicate empty
   * option. The public `options` property stays the caller's list.
   */
  private get listOptions(): ZlSelectOption[] {
    return [{ value: "", label: this.placeholder }, ...this.options.filter((o) => o.value !== "")];
  }

  override render() {
    const labelId = `${this.baseId}-label`;
    const errorId = `${this.baseId}-error`;
    const showError = Boolean(this.error);
    const selected =
      this.value === "" ? undefined : this.options.find((option) => option.value === this.value);
    const rootClass = classMap({
      "zr-select": true,
      "zr-select--open": this.open,
      "zr-select--invalid": this.invalid || showError,
      "zr-select--disabled": this.disabled,
    });

    return html`
      <div class=${rootClass} part="root">
        ${this.renderLabel(labelId)}
        <div class="zr-select__field" part="field">
          <select
            class="zr-select__native"
            part="native"
            id=${`${this.baseId}-native`}
            data-testid=${ifDefined(this.nativeTestId())}
            aria-labelledby=${this.label ? labelId : nothing}
            aria-label=${ifDefined(this.label ? undefined : this.ariaLabelText)}
            aria-invalid=${this.invalid || showError ? "true" : "false"}
            aria-describedby=${showError ? errorId : nothing}
            ?disabled=${this.disabled}
            ?required=${this.required}
            @change=${this.handleNativeChange}
          >
            ${this.listOptions.map(
              (option) =>
                html`<option
                  value=${option.value}
                  ?disabled=${option.disabled ?? false}
                  .selected=${live(option.value === this.value)}
                >${option.label}</option>`,
            )}
          </select>
          <div
            class="zr-select__trigger"
            part="trigger"
            aria-hidden="true"
            @click=${this.handleTriggerClick}
          >
            <span
              class=${classMap({
                "zr-select__value": true,
                "zr-select__value--placeholder": !selected,
              })}
            >
              ${selected ? selected.label : this.placeholder}
            </span>
            <zl-icon class="zr-select__icon" name="chevron-down" size="16" decorative></zl-icon>
          </div>
          <ul class="zr-select__listbox" part="listbox" aria-hidden="true" ?hidden=${!this.open}>
            ${this.listOptions.map((option) => this.renderOption(option))}
          </ul>
        </div>
        <div
          class="zr-select__error"
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

  private renderLabel(labelId: string) {
    if (!this.label) {
      return null;
    }
    return html`
      <label class="zr-select__label" part="label" id=${labelId} @click=${this.handleLabelClick}>
        <span>${this.label}</span>
        ${this.required
          ? html`<span class="zr-select__required" aria-hidden="true">*</span>`
          : null}
      </label>
    `;
  }

  private renderOption(option: ZlSelectOption) {
    const isSelected = option.value === this.value;
    return html`
      <li
        class="zr-select__option"
        part="option"
        data-value=${option.value}
        data-selected=${isSelected ? "" : nothing}
        data-active=${this.open && option.value === this.activeValue ? "" : nothing}
        data-disabled=${option.disabled ? "" : nothing}
        @click=${() => this.handleOptionClick(option)}
        @pointermove=${() => this.handleOptionPointerMove(option)}
      >
        <span class="zr-select__option-label">${option.label}</span>
        <zl-icon class="zr-select__option-check" name="check" size="16" decorative></zl-icon>
      </li>
    `;
  }

  private handleLabelClick = (): void => {
    if (!this.disabled) {
      this.nativeEl?.focus();
    }
  };

  private handleTriggerClick = (): void => {
    if (this.disabled) {
      return;
    }
    this.open = !this.open;
  };

  /**
   * The native `<select>` is the source of truth for keyboard, AT, and
   * automation. Its `change` event covers native-popup selection as well as
   * programmatic value-setting by automation drivers.
   */
  private handleNativeChange = (event: Event): void => {
    const next = (event.target as HTMLSelectElement).value;
    this.open = false;
    this.commitValue(next);
  };

  private handleOptionClick(option: ZlSelectOption): void {
    if (option.disabled) {
      return;
    }
    this.open = false;
    this.nativeEl?.focus();
    this.commitValue(option.value);
  }

  private handleOptionPointerMove(option: ZlSelectOption): void {
    if (!option.disabled && option.value !== this.activeValue) {
      this.activeValue = option.value;
    }
  }

  private handleDocumentPointerDown = (event: Event): void => {
    if (this.open && !event.composedPath().includes(this)) {
      this.open = false;
    }
  };

  /**
   * Escape closes the styled popup and stops propagation so it doesn't also
   * dismiss an enclosing dialog.
   */
  private handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (this.open && event.key === "Escape") {
      event.stopPropagation();
      this.open = false;
      this.nativeEl?.focus();
    }
  };

  /**
   * Apply a new value from any input path (native select, styled popup), keeping
   * `value`, form state, and listeners in sync and emitting the `zl-change`
   * contract plus a composed native `change` for host forms.
   */
  private commitValue(next: string): void {
    if (next === this.value) {
      return;
    }
    this.value = next;
    this.syncFormState();
    emit<ZlSelectChangeDetail>(this, "zl-change", { name: this.name, value: this.value });
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  private syncFormState(): void {
    this.internals.setFormValue?.(this.value || null);
    if (this.required && !this.value) {
      this.internals.setValidity?.(
        { valueMissing: true },
        "Please select an item in the list.",
        this.nativeEl ?? undefined,
      );
    } else {
      this.internals.setValidity?.({});
    }
  }

  private nativeTestId(): string | undefined {
    if (this.name) {
      return `zitadel-select-${this.name}`;
    }
    if (this.testId) {
      return `${this.testId}-native`;
    }
    return undefined;
  }
}

export const zlSelectManifest: AtomManifest = {
  tag: "zl-select",
  attrs: [
    "name",
    "label",
    "value",
    "placeholder",
    "options",
    "required",
    "error",
    "invalid",
    "disabled",
    "open",
    "aria-label",
    "data-testid",
  ],
  parts: ["root", "label", "field", "native", "trigger", "listbox", "option", "error"],
  slots: [],
  events: ["zl-change"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-select": ZlSelect;
  }
}

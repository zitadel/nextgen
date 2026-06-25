import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { ifDefined } from "lit/directives/if-defined.js";

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
 * Atom: `<zl-select>` — a select-only combobox bound to a single choice.
 *
 * Spec lineage (file `8UjCXw8yemgljmbkWGrSfE`, "Zitadel - Design System - External"):
 *   - trigger + open/selected matrix:  node `4397:4816` (Dropdown)
 *   - option (Items) state matrix:      node `4397:4098` (Input text)
 *
 * The trigger mirrors `<zl-field>`'s box; the popup is a `role="listbox"` whose
 * options paint the Figma hover / keyboard-active wash and the chosen row's
 * solid fill + check glyph. Follows the WAI-ARIA select-only combobox pattern:
 * focus stays on the trigger and `aria-activedescendant` tracks the active
 * option, so arrow keys move a virtual cursor without moving DOM focus.
 *
 * Form participation: `<zl-select>` is a form-associated custom element; its
 * `value` is the selected option's value (empty string = nothing chosen).
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
  @property({ type: Boolean, reflect: true }) accessor disabled = false;
  @property({ type: Boolean, reflect: true }) accessor open = false;
  @property({ attribute: "aria-label" }) accessor ariaLabelText: string | undefined = undefined;
  @property({ attribute: "data-testid" }) accessor testId: string | undefined = undefined;

  @state() private accessor activeIndex = -1;

  @query(".zr-select__trigger") private accessor triggerEl: HTMLButtonElement | null = null;

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
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this.handleDocumentPointerDown, true);
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
    this.triggerEl?.focus(options);
  }

  override render() {
    const labelId = `${this.baseId}-label`;
    const listboxId = `${this.baseId}-listbox`;
    const selected = this.options.find((option) => option.value === this.value);
    const rootClass = classMap({
      "zr-select": true,
      "zr-select--open": this.open,
      "zr-select--disabled": this.disabled,
    });

    return html`
      <div class=${rootClass} part="root">
        ${this.renderLabel(labelId)}
        <div class="zr-select__field" part="field">
          <button
            type="button"
            class="zr-select__trigger"
            part="trigger"
            id=${`${this.baseId}-trigger`}
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded=${this.open ? "true" : "false"}
            aria-controls=${listboxId}
            aria-labelledby=${this.label ? labelId : nothing}
            aria-label=${ifDefined(this.label ? undefined : this.ariaLabelText)}
            aria-activedescendant=${this.open && this.activeIndex >= 0
              ? this.optionId(this.activeIndex)
              : nothing}
            data-testid=${ifDefined(this.triggerTestId())}
            ?disabled=${this.disabled}
            @click=${this.handleTriggerClick}
            @keydown=${this.handleTriggerKeyDown}
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
          </button>
          <ul
            class="zr-select__listbox"
            part="listbox"
            id=${listboxId}
            role="listbox"
            tabindex="-1"
            aria-labelledby=${this.label ? labelId : nothing}
            ?hidden=${!this.open}
          >
            ${this.options.map((option, index) => this.renderOption(option, index))}
          </ul>
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

  private renderOption(option: ZlSelectOption, index: number) {
    const isSelected = option.value === this.value;
    return html`
      <li
        class="zr-select__option"
        part="option"
        id=${this.optionId(index)}
        role="option"
        aria-selected=${isSelected ? "true" : "false"}
        aria-disabled=${option.disabled ? "true" : nothing}
        data-active=${this.open && index === this.activeIndex ? "true" : nothing}
        data-value=${option.value}
        @click=${() => this.handleOptionClick(index)}
        @pointermove=${() => this.handleOptionPointerMove(index)}
      >
        <span class="zr-select__option-label">${option.label}</span>
        <zl-icon class="zr-select__option-check" name="check" size="16" decorative></zl-icon>
      </li>
    `;
  }

  private optionId(index: number): string {
    return `${this.baseId}-option-${index}`;
  }

  private handleLabelClick = (): void => {
    if (!this.disabled) {
      this.triggerEl?.focus();
    }
  };

  private handleTriggerClick = (): void => {
    if (this.disabled) {
      return;
    }
    if (this.open) {
      this.close();
    } else {
      this.openMenu();
    }
  };

  private handleTriggerKeyDown = (event: KeyboardEvent): void => {
    if (this.disabled) {
      return;
    }
    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        if (!this.open) {
          this.openMenu();
        } else {
          this.moveActive(event.key === "ArrowDown" ? 1 : -1);
        }
        break;
      case "Home":
        if (this.open) {
          event.preventDefault();
          this.setActive(this.firstEnabledIndex());
        }
        break;
      case "End":
        if (this.open) {
          event.preventDefault();
          this.setActive(this.lastEnabledIndex());
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (this.open) {
          this.commitActive();
        } else {
          this.openMenu();
        }
        break;
      case "Escape":
        if (this.open) {
          event.preventDefault();
          this.close();
        }
        break;
      case "Tab":
        if (this.open) {
          this.close();
        }
        break;
      default:
        break;
    }
  };

  private handleOptionClick(index: number): void {
    if (this.options[index]?.disabled) {
      return;
    }
    this.setActive(index);
    this.commitActive();
  }

  private handleOptionPointerMove(index: number): void {
    if (!this.options[index]?.disabled && index !== this.activeIndex) {
      this.activeIndex = index;
    }
  }

  private handleDocumentPointerDown = (event: Event): void => {
    if (this.open && !event.composedPath().includes(this)) {
      this.close();
    }
  };

  private openMenu(): void {
    if (this.options.length === 0) {
      return;
    }
    this.open = true;
    const selectedIndex = this.options.findIndex((option) => option.value === this.value);
    this.activeIndex = selectedIndex >= 0 ? selectedIndex : this.firstEnabledIndex();
  }

  private close(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.activeIndex = -1;
    this.triggerEl?.focus();
  }

  private commitActive(): void {
    const option = this.options[this.activeIndex];
    if (!option || option.disabled) {
      return;
    }
    const changed = option.value !== this.value;
    this.value = option.value;
    this.open = false;
    this.activeIndex = -1;
    this.triggerEl?.focus();
    this.syncFormState();
    if (changed) {
      emit<ZlSelectChangeDetail>(this, "zl-change", { name: this.name, value: this.value });
      this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    }
  }

  private moveActive(delta: number): void {
    const count = this.options.length;
    if (count === 0) {
      return;
    }
    let next = this.activeIndex;
    for (let step = 0; step < count; step += 1) {
      next = (next + delta + count) % count;
      if (!this.options[next]?.disabled) {
        this.setActive(next);
        return;
      }
    }
  }

  private setActive(index: number): void {
    if (index >= 0 && index < this.options.length) {
      this.activeIndex = index;
    }
  }

  private firstEnabledIndex(): number {
    return this.options.findIndex((option) => !option.disabled);
  }

  private lastEnabledIndex(): number {
    for (let index = this.options.length - 1; index >= 0; index -= 1) {
      if (!this.options[index]?.disabled) {
        return index;
      }
    }
    return -1;
  }

  private syncFormState(): void {
    this.internals.setFormValue?.(this.value || null);
    if (this.required && !this.value) {
      this.internals.setValidity?.(
        { valueMissing: true },
        "Please select an item in the list.",
        this.triggerEl ?? undefined,
      );
    } else {
      this.internals.setValidity?.({});
    }
  }

  private triggerTestId(): string | undefined {
    if (this.name) {
      return `zitadel-select-${this.name}`;
    }
    if (this.testId) {
      return `${this.testId}-trigger`;
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
    "disabled",
    "open",
    "aria-label",
    "data-testid",
  ],
  parts: ["root", "label", "field", "trigger", "listbox", "option"],
  slots: [],
  events: ["zl-change"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-select": ZlSelect;
  }
}

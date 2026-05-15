import type { CreateFlow201StepFieldsType } from "@zitadel-nextgen/api/generated/model";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { nextUid } from "../internal/unique-id.js";
import type { AtomManifest } from "../manifest.js";
import { baseHostStyles } from "../styles/base.js";
import { cssTokenVar as v } from "../styles/css-helpers.js";
import { focusVisibleStyles } from "../styles/focus-ring.js";
import { tokens } from "../tokens/catalogue.js";

/**
 * Alias of the orval-generated wire enum for field types so the atom's
 * accepted `type` values track the API contract exactly. Keeping this an
 * explicit alias (rather than re-importing the orval name everywhere) means
 * `<zl-field>` consumers still get a stable, atom-named symbol.
 */
export type ZlFieldType = CreateFlow201StepFieldsType;

/**
 * Atom: `<zl-field>` — labelled input bound to a step `field`.
 *
 * Internally renders the label + input + error trio as named `::part()`s so
 * the override ladder tier 2 (`zl-field::part(input)`) works without exposing
 * separate atoms. Templates use a single tag per spec.
 *
 * Form participation: `<zl-field>` is a form-associated custom element
 * (`static formAssociated = true`) so it can live inside a `<form>` and have
 * its value submitted with the form. Combined with the real `<form>` the
 * `<zitadel-login>` orchestrator renders, this gives Enter-to-submit, browser
 * autofill, and "save password" prompts that screen readers and password
 * managers expect from a sign-in screen. The shadow root also delegates focus
 * so tabbing into the host lands directly on the input.
 *
 * Spec: `docs/design/branding/validator.md`, `docs/design/branding/templates.md`.
 */
@customElement("zl-field")
export class ZlField extends LitElement {
  static formAssociated = true;

  static override shadowRootOptions: ShadowRootInit = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  static override styles = [
    baseHostStyles,
    css`
      :host {
        display: block;
      }
      .root {
        display: flex;
        flex-direction: column;
        gap: ${v(tokens.space.s2)};
      }
      .label {
        display: inline-flex;
        align-items: center;
        gap: ${v(tokens.space.s1)};
        font-size: ${v(tokens.font.sizeSm)};
        font-weight: ${v(tokens.font.weightMedium)};
        color: ${v(tokens.color.text)};
      }
      .required-marker {
        color: ${v(tokens.color.error)};
      }
      .control {
        display: flex;
        align-items: stretch;
        gap: ${v(tokens.space.s2)};
      }
      .input-wrap {
        position: relative;
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        gap: ${v(tokens.space.s2)};
        padding-inline: ${v(tokens.control.paddingX)};
        height: ${v(tokens.control.heightMd)};
        border-radius: ${v(tokens.radius.md)};
        border: ${v(tokens.border.width)} solid ${v(tokens.color.border)};
        background: ${v(tokens.color.surface)};
        transition:
          border-color ${v(tokens.motion.durationFast)} ${v(tokens.motion.easeDefault)},
          box-shadow ${v(tokens.motion.durationFast)} ${v(tokens.motion.easeDefault)};
      }
      .input-wrap:focus-within {
        ${focusVisibleStyles};
        border-color: ${v(tokens.color.primary)};
      }
      :host([invalid]) .input-wrap {
        border-color: ${v(tokens.color.error)};
      }
      .input {
        flex: 1 1 auto;
        min-width: 0;
        height: 100%;
        border: 0;
        outline: 0;
        background: transparent;
        color: ${v(tokens.color.text)};
        font: inherit;
      }
      .input::placeholder {
        color: ${v(tokens.color.textMuted)};
      }
      .input[disabled] {
        cursor: not-allowed;
      }
      ::slotted(*) {
        color: ${v(tokens.color.textMuted)};
      }
      .help,
      .error {
        font-size: ${v(tokens.font.sizeXs)};
        line-height: ${v(tokens.font.lineHeightNormal)};
      }
      .help {
        color: ${v(tokens.color.textMuted)};
      }
      .error {
        color: ${v(tokens.color.error)};
      }
      .help[hidden],
      .error[hidden] {
        display: none;
      }
    `,
  ];

  @property() accessor name = "";

  @property() accessor label = "";

  @property() accessor type: ZlFieldType = "text";

  @property() accessor value = "";

  @property() accessor placeholder = "";

  @property() accessor autocomplete: string | undefined = undefined;

  @property() accessor pattern: string | undefined = undefined;

  @property() accessor error = "";

  @property({ type: Boolean }) accessor required = false;

  @property({ type: Boolean }) accessor disabled = false;

  @property({ type: Boolean, reflect: true }) accessor invalid = false;

  @state() private accessor hasHelp = false;

  private readonly inputId = nextUid("zl-field");

  private readonly internals: ElementInternals;

  constructor() {
    super();
    this.internals = this.attachInternals();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.syncFormState();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("value") || changed.has("required") || changed.has("error")) {
      this.syncFormState();
    }
  }

  formResetCallback(): void {
    this.value = "";
  }

  formStateRestoreCallback(state: string | null): void {
    this.value = state ?? "";
  }

  override focus(options?: FocusOptions): void {
    this.shadowRoot?.querySelector<HTMLInputElement>("input")?.focus(options);
  }

  override render() {
    const labelId = `${this.inputId}-label`;
    const errorId = `${this.inputId}-error`;
    const helpId = `${this.inputId}-help`;
    const showError = Boolean(this.error);
    const describedBy = [showError ? errorId : null, this.hasHelp ? helpId : null]
      .filter(Boolean)
      .join(" ");
    return html`
      <div class="root" part="root">
        ${this.label
          ? html`
              <label class="label" part="label" id=${labelId} for=${this.inputId}>
                <span>${this.label}</span>
                ${this.required
                  ? html`<span class="required-marker" aria-hidden="true">*</span>`
                  : null}
              </label>
            `
          : null}
        <div class="control">
          <div class="input-wrap">
            <slot name="prefix"></slot>
            <input
              class="input"
              part="input"
              id=${this.inputId}
              name=${this.name}
              type=${this.type}
              .value=${this.value}
              placeholder=${this.placeholder}
              autocomplete=${this.autocomplete ?? ""}
              pattern=${this.pattern ?? ""}
              ?required=${this.required}
              ?disabled=${this.disabled}
              aria-invalid=${this.invalid || showError ? "true" : "false"}
              aria-describedby=${describedBy || nothing}
              @input=${this.handleInput}
              @change=${this.handleChange}
              @keydown=${this.handleKeyDown}
            />
            <slot name="suffix"></slot>
          </div>
        </div>
        <div class="help" part="help" id=${helpId} ?hidden=${!this.hasHelp}>
          <slot name="help" @slotchange=${this.handleHelpSlotChange}></slot>
        </div>
        <div class="error" part="error" id=${errorId} role="alert" ?hidden=${!showError}>
          ${this.error}
        </div>
      </div>
    `;
  }

  private syncFormState(): void {
    // jsdom partially implements ElementInternals — guard the form-association
    // calls so unit tests don't throw. Real browsers always have these.
    this.internals.setFormValue?.(this.value);
    if (this.required && !this.value) {
      this.internals.setValidity?.({ valueMissing: true }, "Please fill out this field.");
    } else if (this.error) {
      this.internals.setValidity?.({ customError: true }, this.error);
    } else {
      this.internals.setValidity?.({});
    }
  }

  private handleHelpSlotChange = (event: Event): void => {
    const slot = event.target as HTMLSlotElement;
    this.hasHelp = slot.assignedNodes({ flatten: true }).length > 0;
  };

  private handleInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    this.value = input.value;
    this.dispatchEvent(
      new CustomEvent("zl-input", {
        bubbles: true,
        composed: true,
        detail: { name: this.name, value: this.value },
      }),
    );
  };

  private handleChange = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    this.value = input.value;
    // Re-fire `change` from the host so light-DOM listeners see it. `change`
    // does not bubble across shadow boundaries by default.
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    // Forward Enter to the owning form so pressing Enter inside the field
    // submits the orchestrator's `<form>`. Without this, the input is a
    // shadow-DOM island and Enter is a no-op — bad for keyboard users and
    // bad for password-manager UX.
    if (
      event.key === "Enter" &&
      !event.isComposing &&
      !event.shiftKey &&
      !event.altKey &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      const form = this.internals.form;
      if (form) {
        event.preventDefault();
        form.requestSubmit();
      }
    }
  };
}

export const zlFieldManifest: AtomManifest = {
  tag: "zl-field",
  consumes: { field: { required: true } },
  attrs: [
    "name",
    "label",
    "type",
    "value",
    "placeholder",
    "autocomplete",
    "pattern",
    "required",
    "disabled",
    "invalid",
    "error",
  ],
  parts: ["root", "label", "input", "help", "error"],
  slots: ["prefix", "suffix", "help"],
  events: ["zl-input"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-field": ZlField;
  }
}

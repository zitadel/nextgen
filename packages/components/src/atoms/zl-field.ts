import type { CreateFlow201StepFieldsItemType } from "@zitadel/api/generated/model";
import { LitElement, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { ifDefined } from "lit/directives/if-defined.js";
import { live } from "lit/directives/live.js";

import fieldStyles from "./zl-field.css?inline";

import { emit } from "../internal/emit.js";
import { hookName } from "../internal/hook-name.js";
import { nextUid } from "../internal/unique-id.js";
import type { AtomManifest } from "../manifest.js";
import { baseHostStyles, surfaceStyles } from "../styles/index.js";

import "./zl-icon.js";
import type { IconName } from "./zl-icon.js";

/**
 * Alias of the orval-generated wire enum for field types so the atom's
 * accepted `type` values track the API contract exactly.
 */
export type ZlFieldType = CreateFlow201StepFieldsItemType;

/** Detail shape emitted by the `zl-input` event (input + clear). */
export type ZlFieldInputDetail = { name: string; value: string };

/**
 * Atom: `<zl-field>` — labelled input bound to a step `field`. The shadcn
 * `Field` + `Input` pair, re-skinned with our tokens.
 *
 *   root         flex column, 12px gap
 *   label row    label, plus an optional right-aligned "Forgot your password?"
 *                link — the design puts it here rather than under the control
 *   input        36px tall, 10px/4px padding, `--zl-radius-md`, a
 *                `--zl-input` edge over `--zl-input-fill`
 *   focus        the edge takes `--zl-ring` and a 3px ring sits outside it
 *   trailing     cross (clear) | alert-circle (error) | check (success)
 *   description  14/20 in `--zl-muted-foreground`, the size the sign-up
 *                frame's password hint uses
 *
 * Form participation: `<zl-field>` is a form-associated custom element.
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
    ...surfaceStyles(fieldStyles),
  ];

  /**
   * Field name — used as the key in form submission and in `zl-input` event
   * detail. For form-associated custom elements the browser owns a native
   * `name` property; using `@property()` would create a conflicting accessor
   * that loses sync with the DOM attribute. We therefore manage it manually.
   */
  get name(): string {
    return this.getAttribute("name") ?? "";
  }

  set name(value: string) {
    this.setAttribute("name", value);
  }
  @property() accessor label = "";
  @property() accessor type: ZlFieldType = "text";
  @property() accessor value = "";
  @property() accessor placeholder = "";
  @property() accessor autocomplete: string | undefined = undefined;
  @property() accessor pattern: string | undefined = undefined;
  @property() accessor error = "";
  @property() accessor success = "";
  @property({ attribute: "data-testid" }) accessor testId: string | undefined = undefined;
  @property({ attribute: "forgot-password-href" }) accessor forgotPasswordHref: string | undefined =
    undefined;
  @property({ attribute: "forgot-password-label" }) accessor forgotPasswordLabel =
    "Forgot password?";
  /**
   * Flow action the forgot-password link runs. Set it and the link stops being
   * a navigation and becomes a step transition, emitting `zl-submit` like a
   * button does — the orchestrator's click delegation can't reach it, because
   * an event crossing this shadow boundary retargets to the host and its
   * `[data-action]` lookup finds nothing.
   */
  @property({ attribute: "forgot-password-action" }) accessor forgotPasswordAction:
    | string
    | undefined = undefined;
  @property({ type: Boolean, attribute: "trailing-icon" }) accessor trailingIcon = true;
  @property({ type: Boolean }) accessor required = false;
  @property({ type: Boolean, reflect: true }) accessor disabled = false;
  @property({ type: Boolean, reflect: true }) accessor invalid = false;

  @state() private accessor hasHelp = false;
  @state() private accessor hasSuffixSlot = false;

  @query(".zr-field__input") private accessor inputEl: HTMLInputElement | null = null;

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
    this.inputEl?.focus(options);
  }

  /**
   * The string this control contributes to form submission — the uniform
   * read/write contract `<zitadel-login>` uses to capture and restore field
   * values without knowing each atom's internal shape. The getter reads the
   * live `<input>` so browser/password-manager autofill that writes the native
   * control directly (bypassing the `value` property and its `input` event) is
   * still captured.
   */
  get formValue(): string {
    const native = this.inputEl ?? this.shadowRoot?.querySelector<HTMLInputElement>("input");
    return native ? native.value : this.value;
  }

  set formValue(value: string) {
    this.value = value;
    const native = this.inputEl ?? this.shadowRoot?.querySelector<HTMLInputElement>("input");
    if (native && native.value !== value) {
      native.value = value;
    }
  }

  override render() {
    const labelId = `${this.inputId}-label`;
    const errorId = `${this.inputId}-error`;
    const successId = `${this.inputId}-success`;
    const helpId = `${this.inputId}-help`;
    const showError = Boolean(this.error);
    const showSuccess = Boolean(this.success) && !showError && !this.invalid;
    const describedBy = [
      showError ? errorId : null,
      showSuccess ? successId : null,
      this.hasHelp ? helpId : null,
    ]
      .filter(Boolean)
      .join(" ");
    const rootClass = classMap({
      "zr-field": true,
      "zr-field--invalid": this.invalid || showError,
      "zr-field--success": showSuccess,
      "zr-field--disabled": this.disabled,
    });
    const showDefaultTrailing =
      this.trailingIcon && !this.hasSuffixSlot && !this.disabled;
    const trailing = showDefaultTrailing ? this.renderTrailingIcon() : null;
    const wrapClass = classMap({
      "zr-field__wrap": true,
      "zr-field__wrap--trailing": showDefaultTrailing,
    });

    return html`
      <div class=${rootClass} part="root">
        ${this.renderLabelRow(labelId)}
        <div class=${wrapClass} part="input-wrap">
          <slot name="prefix"></slot>
          <input
            class="zr-field__input"
            part="input"
            id=${this.inputId}
            data-testid=${ifDefined(this.nativeInputTestId())}
            name=${this.name}
            type=${this.type}
            .value=${live(this.value)}
            placeholder=${this.placeholder}
            autocomplete=${ifDefined(this.autocomplete)}
            pattern=${ifDefined(this.pattern)}
            ?required=${this.required}
            ?disabled=${this.disabled}
            aria-invalid=${this.invalid || showError ? "true" : "false"}
            aria-describedby=${describedBy || nothing}
            @input=${this.handleInput}
            @change=${this.handleChange}
            @keydown=${this.handleKeyDown}
          />
          <slot name="suffix" @slotchange=${this.handleSuffixSlotChange}></slot>
          ${trailing}
        </div>
        <div class="zr-field__help" part="help" id=${helpId} ?hidden=${!this.hasHelp}>
          <slot name="help" @slotchange=${this.handleHelpSlotChange}></slot>
        </div>
        <div
          class="zr-field__success"
          part="success"
          id=${successId}
          role="status"
          ?hidden=${!showSuccess}
        >
          ${this.success}
        </div>
        <div class="zr-field__error" part="error" id=${errorId} role="alert" ?hidden=${!showError}>
          ${this.error}
        </div>
      </div>
    `;
  }

  private renderLabelRow(labelId: string) {
    if (!this.label) {
      return null;
    }
    if (this.forgotPasswordHref) {
      return html`
        <div class="zr-field__label-row" part="label-row">
          <label class="zr-field__label" part="label" id=${labelId} for=${this.inputId}>
            <span>${this.label}</span>
            ${this.required
              ? html`<span class="zr-field__required" aria-hidden="true">*</span>`
              : null}
          </label>
          <a
            class="zr-field__link"
            part="forgot-link"
            href=${this.forgotPasswordHref}
            @click=${this.onForgotPasswordClick}
            >${this.forgotPasswordLabel}</a
          >
        </div>
      `;
    }
    return html`
      <label class="zr-field__label" part="label" id=${labelId} for=${this.inputId}>
        <span>${this.label}</span>
        ${this.required
          ? html`<span class="zr-field__required" aria-hidden="true">*</span>`
          : null}
      </label>
    `;
  }

  private renderTrailingIcon() {
    let iconName: IconName = "cross";
    let tone: "default" | "error" | "success" = "default";
    let clearable = true;

    if (this.invalid || this.error) {
      iconName = "alert-circle";
      tone = "error";
      clearable = false;
    } else if (this.success) {
      iconName = "check";
      tone = "success";
      clearable = false;
    }

    const icon = html`<zl-icon name=${iconName} size="16" tone=${tone} decorative></zl-icon>`;

    if (!clearable) {
      return html`<span class="zr-field__trailing" part="trailing-icon">${icon}</span>`;
    }

    return html`
      <span class="zr-field__trailing" part="trailing-icon">
        <button
          type="button"
          class="zr-field__trailing-action"
          part="trailing-action"
          aria-label="Clear"
          ?disabled=${this.disabled}
          @click=${this.handleClear}
        >
          ${icon}
        </button>
      </span>
    `;
  }

  private syncFormState(): void {
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

  private handleSuffixSlotChange = (event: Event): void => {
    const slot = event.target as HTMLSlotElement;
    this.hasSuffixSlot = slot.assignedNodes({ flatten: true }).length > 0;
  };

  private handleClear = (): void => {
    this.value = "";
    emit<ZlFieldInputDetail>(this, "zl-input", { name: this.name, value: this.value });
    this.syncFormState();
    this.dispatchNativeInput();
    this.inputEl?.focus();
  };

  /**
   * With no `forgot-password-action` the link is a plain navigation and this
   * does nothing — a tenant pointing it at their own recovery page still gets
   * an ordinary anchor, middle-click and all.
   */
  private onForgotPasswordClick = (event: MouseEvent): void => {
    if (!this.forgotPasswordAction) return;
    event.preventDefault();
    emit<{ action: string | null }>(this, "zl-submit", { action: this.forgotPasswordAction });
  };

  private handleInput = (event: Event): void => {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    this.value = input.value;
    this.syncFormState();
    emit<ZlFieldInputDetail>(this, "zl-input", { name: this.name, value: this.value });
    this.dispatchNativeInput(event);
  };

  private handleChange = (event: Event): void => {
    event.stopPropagation();
    const input = event.target as HTMLInputElement;
    this.value = input.value;
    this.syncFormState();
    this.dispatchNativeChange();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
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

  private nativeInputTestId(): string | undefined {
    if (this.name) {
      // Field host hooks use zitadel-field-*; native hooks can be name-first
      // without colliding with the host, unlike action buttons. The hook
      // token is normalised (x-auth-methods#password → password) while
      // `name` stays the raw form key.
      return `zitadel-input-${hookName(this.name)}`;
    }
    if (this.testId) {
      return `${this.testId}-input`;
    }
    return undefined;
  }

  private dispatchNativeInput(source?: Event): void {
    if (typeof InputEvent === "function") {
      const input = source instanceof InputEvent ? source : undefined;
      this.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          composed: true,
          data: input?.data ?? null,
          inputType: input?.inputType ?? "",
          isComposing: input?.isComposing ?? false,
        }),
      );
      return;
    }
    this.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  private dispatchNativeChange(): void {
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
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
    "data-testid",
    "required",
    "disabled",
    "invalid",
    "error",
    "success",
    "forgot-password-href",
    "forgot-password-label",
    "forgot-password-action",
    "trailing-icon",
  ],
  parts: [
    "root",
    "label",
    "label-row",
    "forgot-link",
    "input-wrap",
    "input",
    "trailing-icon",
    "trailing-action",
    "help",
    "success",
    "error",
  ],
  slots: ["prefix", "suffix", "help"],
  events: ["zl-input", "zl-submit"],
} as const;

declare global {
  interface HTMLElementTagNameMap {
    "zl-field": ZlField;
  }
}

import { LitElement } from "lit";
import { property, state } from "lit/decorators.js";

/**
 * Base for the form-associated input atoms: `ElementInternals`, focus
 * delegation to the native control, the browser-owned `name`, the stable test
 * hook on the native control, and the form lifecycle the browser drives.
 *
 * Reset, state restore and `<fieldset disabled>` are handled here, so every
 * atom behaves like a native control without re-implementing them. A subclass
 * only describes its value: how to read and write it as the string the form
 * submits (`formValue`), and where its default comes from.
 */
export abstract class FormAtom extends LitElement {
  static formAssociated = true;

  /** The atom's own `disabled` attribute. See {@link isDisabled}. */
  @property({ type: Boolean, reflect: true }) accessor disabled = false;

  /** Set by the browser while an enclosing `<fieldset disabled>` applies. */
  @state() protected accessor formDisabled = false;

  /**
   * Whether the control is disabled, by its own attribute or by an enclosing
   * `<fieldset disabled>`. Render and handlers read this, never `disabled`.
   */
  protected get isDisabled(): boolean {
    return this.disabled || this.formDisabled;
  }

  /**
   * The string this atom contributes to the form: the uniform read/write
   * contract `<zitadel-login>` uses to capture and restore field values
   * without knowing each atom's internal shape. Reset and restore go through
   * it too, so they reach the native control, not only the atom's property.
   */
  abstract get formValue(): string;
  abstract set formValue(value: string);

  /**
   * The initial value, read from markup the way native controls do: the
   * `value` attribute for a field or select, the `checked` attribute for a
   * checkbox.
   */
  protected abstract readDefaultFormValue(): string;

  /**
   * Captured once. Re-reading on every connect would be wrong for an atom
   * that reflects live state to its attribute (`<zl-checkbox>` reflects
   * `checked`): moving the element in the DOM would turn the user's input
   * into the default.
   */
  private defaultFormValue: string | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    this.defaultFormValue ??= this.readDefaultFormValue();
  }

  /** `form.reset()`: back to the value from markup, as a native control does. */
  formResetCallback(): void {
    this.formValue = this.defaultFormValue ?? "";
  }

  /** Back/forward or autofill restore: `state` is what was last submitted. */
  formStateRestoreCallback(state: string | null): void {
    this.formValue = state ?? "";
  }

  /** The browser's `<fieldset disabled>` notification. */
  formDisabledCallback(disabled: boolean): void {
    this.formDisabled = disabled;
  }

  static override shadowRootOptions: ShadowRootInit = {
    ...LitElement.shadowRootOptions,
    delegatesFocus: true,
  };

  @property({ attribute: "data-testid" }) accessor testId: string | undefined = undefined;

  protected readonly internals: ElementInternals;

  constructor() {
    super();
    this.internals = this.attachInternals();
  }

  /**
   * Form key, also carried in the atom's event detail. The browser owns a
   * native `name` on form-associated elements and a `@property()` accessor
   * would lose sync with the attribute, so it is read from the attribute.
   */
  get name(): string {
    return this.getAttribute("name") ?? "";
  }

  set name(value: string) {
    this.setAttribute("name", value);
  }

  /** Composed native `change`, so host forms and frameworks see the commit. */
  protected dispatchNativeChange(): void {
    this.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }

  /**
   * Hook for the native control: `zitadel-<kind>-<token>` when the atom is
   * named, else the host's own `data-testid` plus `suffix`.
   */
  protected nativeTestId(kind: string, suffix: string, token = this.name): string | undefined {
    if (this.name) {
      return `zitadel-${kind}-${token}`;
    }
    if (this.testId) {
      return `${this.testId}-${suffix}`;
    }
    return undefined;
  }
}

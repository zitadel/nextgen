import { LitElement } from "lit";
import { property } from "lit/decorators.js";

/**
 * Base for the form-associated input atoms: `ElementInternals`, focus
 * delegation to the native control, the browser-owned `name`, and the stable
 * test hook on the native control.
 */
export abstract class FormAtom extends LitElement {
  static formAssociated = true;

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

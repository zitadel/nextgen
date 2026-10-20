import { LitElement } from "lit";

/**
 * Replaced at build time by the `define` entry in `tsdown.config.ts`, which
 * sets it to `"closed"` for every artifact that ships (the npm library and
 * the standalone file). It does not exist anywhere else, so Vitest, Storybook
 * and any dev server that runs this source get open roots.
 */
declare const __ZITADEL_SHADOW_ROOT_MODE__: ShadowRootMode | undefined;

/**
 * The one place the shadow root mode is decided, for `<zitadel-login>`,
 * `<zitadel-session>`, `<zitadel-logout>` and every `<zl-*>` atom.
 *
 * Closed in a shipped build, so `host.shadowRoot` is `null` and an event from
 * inside is retargeted to the host with `composedPath()` hiding the inner
 * nodes. Open in test and development builds, so component tests and
 * Playwright can pierce the roots. A closed root stops the casual reads, not a
 * script that inspects the element's own properties (Lit keeps a reference to
 * the root there): see "Shadow roots" in the package README.
 */
export const SHADOW_ROOT_MODE: ShadowRootMode =
  typeof __ZITADEL_SHADOW_ROOT_MODE__ === "undefined" ? "open" : __ZITADEL_SHADOW_ROOT_MODE__;

/**
 * Base of every element that renders into a shadow root. A subclass that adds
 * shadow root options spreads `ZlElement.shadowRootOptions`, so the mode is
 * never restated.
 */
export class ZlElement extends LitElement {
  static override shadowRootOptions: ShadowRootInit = {
    ...LitElement.shadowRootOptions,
    mode: SHADOW_ROOT_MODE,
  };

  /**
   * This element's own shadow root. Read it instead of `this.shadowRoot`,
   * which is `null` when the root is closed.
   */
  protected get ownRoot(): ShadowRoot | null {
    return this.renderRoot instanceof ShadowRoot ? this.renderRoot : null;
  }
}

import { LitElement, type PropertyValues, type ReactiveController } from "lit";

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
 * Closed in a shipped build, so a script on the host page cannot reach a field
 * through `host.shadowRoot` (it is `null`), and an event from inside is
 * retargeted to the host with `composedPath()` hiding the inner nodes. Open in
 * test and development builds, so component tests and Playwright can pierce
 * the roots. A closed root is a guard against casual reads, not an isolation
 * boundary: see "What closed roots do not protect" in the package README.
 */
export const SHADOW_ROOT_MODE: ShadowRootMode =
  typeof __ZITADEL_SHADOW_ROOT_MODE__ === "undefined" ? "open" : __ZITADEL_SHADOW_ROOT_MODE__;

type RenderRoot = HTMLElement | DocumentFragment;

/**
 * Where a closed build keeps each element's root. Lit stores it on the public
 * `renderRoot` property, so left alone `host.renderRoot` would hand a page
 * script the root `host.shadowRoot` refuses to. Module scope keeps it out of
 * reach; only {@link ownRoot} reads it.
 */
const closedRoots = new WeakMap<ZlElement, RenderRoot>();

/** Nonzero while Lit's own code runs, the only caller `renderRoot` answers. */
let insideLit = 0;

function runInsideLit<T>(run: () => T): T {
  insideLit += 1;
  try {
    return run();
  } finally {
    insideLit -= 1;
  }
}

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
   * Stops the page calling `attachInternals()` itself, which returns
   * `internals.shadowRoot` even for a closed root. The atoms that need
   * internals attach them in their constructor and set this to `[]`.
   */
  static disabledFeatures: string[] = ["internals"];

  // The entry points where Lit reads `renderRoot`. Nothing else runs inside
  // the window, so a page listener on an event raised by an atom never sees it.
  override connectedCallback(): void {
    runInsideLit(() => super.connectedCallback());
  }

  override addController(controller: ReactiveController): void {
    runInsideLit(() => super.addController(controller));
  }

  protected override performUpdate(): void | Promise<void> {
    // Only the first update creates the root; every later one reads it in
    // `update()` below, which keeps `willUpdate`, `updated` and `render` out.
    if (this.hasUpdated) return super.performUpdate();
    return runInsideLit(() => super.performUpdate());
  }

  protected override update(changed: PropertyValues): void {
    runInsideLit(() => super.update(changed));
  }
}

if (SHADOW_ROOT_MODE === "closed") {
  Object.defineProperty(ZlElement.prototype, "renderRoot", {
    configurable: true,
    get(this: ZlElement): RenderRoot | undefined {
      return insideLit > 0 ? closedRoots.get(this) : undefined;
    },
    set(this: ZlElement, root: RenderRoot) {
      closedRoots.set(this, root);
    },
  });
}

/**
 * The element's own shadow root, or `null` before it has one. Read it instead
 * of `element.shadowRoot`, which is `null` for a closed root, and instead of
 * `element.renderRoot`, which a closed build withholds.
 */
export function ownRoot(element: ZlElement): ShadowRoot | null {
  const root = closedRoots.get(element) ?? element.renderRoot;
  return root instanceof ShadowRoot ? root : null;
}

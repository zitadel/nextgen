/**
 * Page script that makes every shadow root attach open, whatever mode the code
 * asks for. A shipped `@zitadel/components` closes the roots of the login
 * widget and its atoms, and Playwright cannot pierce a closed root, so every
 * browser test of a page that mounts the widget runs this first. It stays a
 * string because it runs in the page, where this package has no DOM types.
 */
export const FORCE_OPEN_SHADOW_ROOTS = `(() => {
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    return attachShadow.call(this, Object.assign({}, init, { mode: "open" }));
  };
})();`;

/** What {@link openShadowRoots} needs of a Playwright `Page` or `BrowserContext`. */
export interface InitScriptTarget {
  addInitScript(script: { content: string }): Promise<unknown>;
}

/**
 * Opens the shadow roots of everything the page or context loads from here on,
 * before any of its scripts run. Call it before the first navigation. The
 * kit's `test` and `widgetTest` do it for every page of the test, so call it
 * yourself only for a context or page you create by hand.
 */
export async function openShadowRoots(target: InitScriptTarget): Promise<void> {
  await target.addInitScript({ content: FORCE_OPEN_SHADOW_ROOTS });
}

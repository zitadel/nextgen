/**
 * Class decorator that registers a custom element unless its tag is already
 * taken, in place of Lit's `@customElement`, which calls
 * `customElements.define` unguarded.
 *
 * A page can evaluate this package twice: the CDN `standalone` build next to
 * the npm copy an SDK pulls in, two versions installed side by side, or a
 * module re-run by HMR or a micro-frontend. The second `define` would throw
 * `NotSupportedError` and leave the rest of that module graph unevaluated, so
 * the first registration wins and a different constructor only gets a
 * warning.
 */
export function defineOnce(tag: string) {
  return (ctor: CustomElementConstructor): void => {
    if (typeof customElements === "undefined") return;
    const registered = customElements.get(tag);
    if (registered === undefined) {
      customElements.define(tag, ctor);
      return;
    }
    if (registered !== ctor) {
      console.warn(
        `[zitadel] <${tag}> is already defined by another copy of @zitadel/components; ` +
          "keeping the first definition.",
      );
    }
  };
}

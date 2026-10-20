export interface RegisteredElement {
  tag: string;
  ctor: CustomElementConstructor;
}

/**
 * Elements that render into their own light DOM (`createRenderRoot` returns
 * the element), so they have no shadow root to open or close; every other
 * element the package defines must have one, and the specs check both ways.
 */
export const LIGHT_DOM_TAGS = ["zl-passkey"];

/**
 * Every custom element `load` defines, in the order it defines them. It reads
 * the definitions as they happen instead of from a list, so an element added
 * to the package is covered without anyone naming it. Call it before anything
 * else in the file imports the package, because a module registers once.
 */
export async function registeredElements(
  load: () => Promise<object>,
): Promise<RegisteredElement[]> {
  const found: RegisteredElement[] = [];
  const define = customElements.define;
  customElements.define = (tag, ctor, options) => {
    found.push({ tag, ctor });
    define.call(customElements, tag, ctor, options);
  };
  try {
    await load();
  } finally {
    customElements.define = define;
  }
  return found;
}

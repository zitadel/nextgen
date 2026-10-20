export interface RegisteredElement {
  tag: string;
  ctor: CustomElementConstructor;
}

/**
 * Elements that render into their own light DOM and so have no shadow root to
 * open or close. Every other element the package defines must have one.
 */
export const LIGHT_DOM_TAGS = ["zl-passkey"];

/**
 * Every custom element `load` defines, in the order it defines them. It reads
 * the definitions as they happen instead of from a list, so an element added
 * to the package is covered without anyone naming it. Call it before anything
 * else in the file imports the package, because a module registers once.
 */
export async function registeredElements(
  load: () => Promise<unknown>,
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

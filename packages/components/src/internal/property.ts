import { property as litProperty } from "lit/decorators.js";
import type { PropertyDeclaration } from "lit";

/**
 * Lit's `@property`, for a public `accessor` that has a declared default: its
 * initial value is that default, and assigning `undefined` or `null` puts it
 * back instead of storing the blank.
 *
 * Framework wrappers assign `undefined` for a prop the caller never set (a
 * React or Vue prop, a Svelte binding), and Lit assigns `null` when an
 * attribute is removed. Without this each of those would replace the default
 * (`heading="Signed in as"` becoming `undefined`), so every wrapper would need
 * its own workaround. Declared here once, every wrapper and every plain-HTML
 * page gets the same behaviour.
 *
 * A property whose default is itself `undefined` or `null` (`project`,
 * `locales`) is left as Lit has it, and so is any value that was supplied.
 * Decorated getters and setters are untouched: a setter owns its coercion.
 *
 * This package compiles with `experimentalDecorators`, which is the only form
 * this supports.
 */
export function property(options?: PropertyDeclaration) {
  const decorate = litProperty(options) as (
    proto: object,
    name: string,
  ) => PropertyDescriptor | undefined;

  const decorator = (proto: object, name: string): PropertyDescriptor | undefined => {
    const decorated = decorate(proto, name);
    const descriptor = decorated ?? Object.getOwnPropertyDescriptor(proto, name);
    if (!descriptor?.get || !descriptor.set) return decorated;

    const { get, set } = descriptor;
    // The default is the value before the first assignment: the initializer has
    // run by then, and nothing else writes the property first.
    const defaults = new WeakMap<object, unknown>();
    return {
      ...descriptor,
      set(this: object, value: unknown) {
        if (!defaults.has(this)) defaults.set(this, get.call(this));
        const fallback = defaults.get(this);
        set.call(this, fallback == null ? value : (value ?? fallback));
      },
    };
  };
  // Legacy decorators may return a replacement descriptor; the library's own
  // type for the decorator does not say so.
  return decorator as unknown as ReturnType<typeof litProperty>;
}

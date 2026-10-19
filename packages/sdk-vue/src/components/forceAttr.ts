/**
 * The prefix that binds a key as a DOM attribute rather than a property.
 *
 * On the client the `^` prefix keeps an unset string prop off the element: Vue
 * would assign an unset property as `""`, which the element cannot tell from an
 * intended empty string, while an unset attribute is simply removed (and
 * restores the element's default). Vue's server renderer only strips the prefix
 * from 3.5.27, so on older Vue it would serialize the key literally
 * (`^variant="page"`) and the element would miss the value before hydration.
 * There is no property to avoid on the server, where every key is written as an
 * attribute anyway, so no prefix is used there. Read per render, not at module
 * load, so a server render in a DOM-less runtime and a client render each get
 * their own answer.
 */
export function forceAttr(): "" | "^" {
  return typeof document === "undefined" ? "" : "^";
}

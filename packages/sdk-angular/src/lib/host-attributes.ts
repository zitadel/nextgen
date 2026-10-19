/**
 * The HTML global attributes, besides `class` and `style`, that move from the
 * wrapper's tag to the widget element. `class`, `style` and `slot` are mirrored
 * instead, and `lang` stays an input of the login wrapper.
 */
const MOVED = new Set([
  "accesskey",
  "autocapitalize",
  "autofocus",
  "contenteditable",
  "dir",
  "draggable",
  "enterkeyhint",
  "hidden",
  "id",
  "inert",
  "inputmode",
  "is",
  "itemid",
  "itemprop",
  "itemref",
  "itemscope",
  "itemtype",
  "nonce",
  "popover",
  "role",
  "spellcheck",
  "tabindex",
  "title",
  "translate",
]);

const isMoved = (name: string): boolean =>
  MOVED.has(name) || name.startsWith("data-") || name.startsWith("aria-");

/**
 * Forwards the standard HTML attributes from an Angular wrapper's tag to the
 * widget element it renders, so a consumer styles and labels the widget the way
 * they would any element: `class`, `style`, `id`, `title`, `hidden`, `role`,
 * `tabindex`, `data-*`, `aria-*` and the other global attributes, whether given
 * as plain attributes (`class="a"`), as bindings (`[class.a]`, `[attr.aria-label]`,
 * `[id]`) or through `ngClass`/`ngStyle`.
 *
 * Angular puts every attribute on the wrapper's own tag, which is a different
 * element from the widget, so they are copied across: once now, and again
 * whenever the tag's attributes change. Most are *moved*, so the page never holds
 * two elements with the same `id`, `role` or `data-testid`. `class` and `style`
 * (and `slot`, which the parent's shadow root reads on the tag itself) are
 * *mirrored* instead: the tag keeps them, and the widget element gets the same
 * classes and declarations, keeping any it sets itself. An attribute that a
 * binding later sets to `null` is removed from the wrapper's tag, where nothing
 * can see it go, so the widget element keeps the last value it was given. Only
 * the attributes a consumer put on the tag are copied: a widget input of the
 * same name is never involved.
 *
 * Returns a function that stops forwarding.
 */
export function forwardHostAttributes(host: HTMLElement, target: HTMLElement): () => void {
  const classes = new Set<string>();
  const declarations = new Set<string>();

  const sync = (): void => {
    for (const { name, value } of Array.from(host.attributes)) {
      if (isMoved(name)) {
        target.setAttribute(name, value);
        host.removeAttribute(name);
      }
    }
    mirrorClass();
    mirrorStyle();
    const slot = host.getAttribute("slot");
    if (slot === null) target.removeAttribute("slot");
    else target.setAttribute("slot", slot);
  };

  const mirrorClass = (): void => {
    const now = new Set((host.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
    for (const name of classes) if (!now.has(name)) target.classList.remove(name);
    for (const name of now) target.classList.add(name);
    classes.clear();
    for (const name of now) classes.add(name);
  };

  const mirrorStyle = (): void => {
    const now = new Map<string, [string, string]>();
    for (let index = 0; index < host.style.length; index++) {
      const property = host.style.item(index);
      now.set(property, [
        host.style.getPropertyValue(property),
        host.style.getPropertyPriority(property),
      ]);
    }
    for (const property of declarations)
      if (!now.has(property)) target.style.removeProperty(property);
    for (const [property, [value, priority]] of now)
      target.style.setProperty(property, value, priority);
    declarations.clear();
    for (const property of now.keys()) declarations.add(property);
  };

  sync();
  if (typeof MutationObserver === "undefined") return () => undefined;
  const observer = new MutationObserver(sync);
  observer.observe(host, { attributes: true });
  return () => observer.disconnect();
}

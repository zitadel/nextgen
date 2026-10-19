/** Props Solid applies to any element as they are, not as an attribute. */
const NATIVE = new Set(["class", "classList", "style", "children", "ref"]);

/** The HTML global attributes, apart from `class` and `style`, that Solid's types accept. */
const GLOBAL = new Set([
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
  "lang",
  "nonce",
  "popover",
  "role",
  "slot",
  "spellcheck",
  "tabindex",
  "title",
  "translate",
]);

const isEvent = (name: string): boolean => /^on[A-Z:]/.test(name);

const isAttribute = (name: string): boolean =>
  GLOBAL.has(name.toLowerCase()) || name.startsWith("data-") || name.startsWith("aria-");

const isForwarded = (name: string): boolean =>
  NATIVE.has(name) || isEvent(name) || isAttribute(name);

/**
 * The standard HTML attributes among the given props, for a wrapper to spread
 * onto its widget element: `class`, `classList`, `style`, `id`, `title`, `slot`,
 * `hidden`, `role`, `tabindex`, `data-*`, `aria-*`, the other global attributes,
 * event handlers and `children`. Anything else is left out, so no stray prop can
 * reach the widget's own configuration.
 *
 * Solid assigns a prop it does not know as a DOM *property* on a custom element,
 * which is not what `data-testid`, `aria-label` or `tabindex` mean there, so the
 * attributes are presented under Solid's `attr:` prefix, which writes them as
 * attributes (`true` as a present attribute, `false` as an absent one). `class`,
 * `classList`, `style`, `children` and event handlers keep their name: Solid
 * applies those to an element correctly. The result reads through to the given
 * props, so it stays reactive.
 */
export function asElementAttributes(props: object): Record<string, unknown> {
  const source = props as Record<string, unknown>;
  const rename = (name: string): string => (isAttribute(name) ? `attr:${name}` : name);
  const forwarded = (): string[] =>
    Reflect.ownKeys(source).filter(
      (key): key is string => typeof key === "string" && isForwarded(key),
    );
  const original = (name: string): string | undefined =>
    forwarded().find((key) => rename(key) === name);
  return new Proxy({} as Record<string, unknown>, {
    ownKeys: () => forwarded().map(rename),
    has: (_, name) => typeof name === "string" && original(name) !== undefined,
    getOwnPropertyDescriptor: (_, name) =>
      typeof name === "string" && original(name) !== undefined
        ? { enumerable: true, configurable: true }
        : undefined,
    get: (_, name) => {
      const key = typeof name === "string" ? original(name) : undefined;
      if (key === undefined) return undefined;
      const value = source[key];
      if (!isAttribute(key)) return value;
      if (value === true) return "";
      if (value === false) return undefined;
      return value;
    },
  });
}

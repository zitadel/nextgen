/** The HTML global attributes, besides `class` and `style`, that Qwik's types accept. */
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

const isStandardAttribute = (name: string): boolean =>
  name === "class" ||
  name === "style" ||
  GLOBAL.has(name.toLowerCase()) ||
  name.startsWith("data-") ||
  name.startsWith("aria-");

/**
 * The standard HTML attributes among a wrapper's props (`class`, `style`, `id`,
 * `title`, `slot`, `hidden`, `role`, `tabindex`, `data-*`, `aria-*`, the other
 * global attributes), for the wrapper to spread onto its widget element ahead of
 * its own attributes, so a widget prop always wins over one of the same name.
 * Anything else is left out, so no stray prop can reach the widget's own
 * configuration. Read per render, so it follows the props.
 */
export function standardAttributes(props: object): Record<string, unknown> {
  const source = props as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(source)
      .filter(isStandardAttribute)
      .map((name) => [name, source[name]]),
  );
}

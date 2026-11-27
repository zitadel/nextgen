import { describe, expect, it } from "vitest";

import { SANITISER_CASES } from "../__fixtures__/sanitiser-cases.js";
import BROWSER_DEFAULTS from "./browser-defaults.json";
import { ATTRIBUTES, ELEMENTS, REMOVED_TAGS, UNWRAPPED_TAGS } from "./allowlist.js";
import { DomPurifySanitiser } from "./dompurify.js";
import { NativeSanitiser } from "./native.js";

const purify = await DomPurifySanitiser.load();
const supported = NativeSanitiser.isSupported();

/**
 * Tags a template might try: everything the browser's defaults list, the
 * allowlist, the removed and unwrapped tags, and tags neither side allows.
 */
const TAGS = [
  ...new Set([
    ...BROWSER_DEFAULTS.elements
      .filter((element) => element.namespace === "http://www.w3.org/1999/xhtml")
      .map((element) => element.name),
    ...ELEMENTS,
    ...REMOVED_TAGS,
    ...UNWRAPPED_TAGS,
    "script",
    "style",
    "iframe",
    "object",
    "embed",
    "noscript",
    "template",
    "video",
    "details",
    "summary",
    "font",
    "center",
    "marquee",
    "base",
    "meta",
    "link",
    "select",
    "option",
    "textarea",
    "x-foo",
    "zl-unknown",
  ]),
];

/**
 * Attributes a template might try: the allowlist, every per-element default,
 * handlers, data and ARIA, and names neither side allows.
 */
const ATTRS = [
  ...new Set([
    ...ATTRIBUTES,
    ...BROWSER_DEFAULTS.attributes.map((attribute) => attribute.name),
    ...BROWSER_DEFAULTS.elements.flatMap((element) =>
      (element.attributes ?? []).map((attribute) => attribute.name),
    ),
    "onclick",
    "onerror",
    "onload",
    "data-x",
    "data-action",
    "aria-label",
    "aria-bogus",
    "formaction",
    "action",
    "xmlns",
    "is",
    "bogus",
    "border",
    "align",
    "bgcolor",
    "download",
  ]),
];

/** Values that exercise links, schemes, word-colon text and markup in values. */
const VALUES = [
  "x",
  "",
  "https://example.com/a",
  "/relative",
  "#frag",
  "javascript:alert(1)",
  " java\tscript:alert(1)",
  "vbscript:x",
  "data:text/html,x",
  "data:image/png;base64,AAAA",
  "intent://x",
  "myapp://open",
  "Hinweis: bitte prüfen",
  "</style><img src=x onerror=alert(1)>",
  "a.png 1x, javascript:alert(1) 2x",
];

/**
 * A seeded random source, so a failure reproduces.
 *
 * @param seed - The seed.
 * @returns A function that returns a number in [0, 1).
 */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Builds one random template fragment.
 *
 * @param next - The random source.
 * @param depth - How deep it may nest.
 * @returns The markup.
 */
function fragment(next: () => number, depth: number): string {
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const parts: string[] = [];
  const count = 1 + Math.floor(next() * 3);
  for (let index = 0; index < count; index += 1) {
    const roll = next();
    if (roll < 0.15) {
      parts.push(pick(["text", "a & b", "x < y", "Label: value"]));
    } else if (roll < 0.2) {
      parts.push("<!-- c -->");
    } else {
      const tag = pick(TAGS);
      const attributes = Array.from(
        { length: Math.floor(next() * 3) },
        () => ` ${pick(ATTRS)}="${pick(VALUES).replaceAll('"', "&quot;")}"`,
      ).join("");
      const inner = depth > 0 ? fragment(next, depth - 1) : pick(["", "t"]);
      parts.push(`<${tag}${attributes}>${inner}</${tag}>`);
    }
  }
  return parts.join("");
}

const CORPUS = Array.from({ length: 3000 }, (_, index) => fragment(random(index + 1), 2));

describe("DomPurifySanitiser", () => {
  it.each(SANITISER_CASES)("%s", (_name, input, expected) => {
    expect(purify.sanitise(input)).toBe(expected);
  });

  it.runIf(supported)(
    "gives the same output as the browser's setHTML() for every generated template",
    () => {
      const native = new NativeSanitiser();
      const differing = CORPUS.filter(
        (html) => native.sanitise(html) !== purify.sanitise(html),
      ).map((html) => ({ html, native: native.sanitise(html), purify: purify.sanitise(html) }));

      expect(differing.slice(0, 5)).toEqual([]);
      expect(differing).toHaveLength(0);
    },
  );
});

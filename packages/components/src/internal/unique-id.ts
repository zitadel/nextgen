/**
 * Monotonic counter for DOM IDs that need to be unique within a document but
 * stable across renders. Used by atoms that wire `<label for>` ↔ `<input id>`
 * inside their Shadow DOM.
 *
 * A counter beats `Math.random()` and `crypto.randomUUID()` here:
 *
 * - Tests get deterministic IDs.
 * - There's zero collision risk within a page.
 * - It's an order of magnitude faster on each component instantiation.
 */
let counter = 0;

export function nextUid(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

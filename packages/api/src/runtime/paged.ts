/**
 * The client's own use of the cursor walk: `pages`, `items` and `all` on one
 * generated function. Internal to the package; `./paging` is what it exports.
 */
import { pages } from "./paging";

/** How a generated function pages: the field holding its items, and the argument carrying `page_token`. */
export type PagingShape = Readonly<{ items: string; arg: number }>;

/**
 * `pages`, `items` and `all` for one generated function. Each takes the
 * function's own arguments; the first page is fetched with them as given, so a
 * `page_token` among them is where it starts.
 */
export function paged(call: (...args: unknown[]) => unknown, shape: PagingShape) {
  const pagesOf = (args: unknown[]) =>
    pages(
      async (token) => call(...(token === undefined ? args : withToken(args, shape.arg, token))),
      { start: (args[shape.arg] as { page_token?: string } | undefined)?.page_token },
    );

  return {
    pages: (...args: unknown[]) => pagesOf(args),
    items: async function* (...args: unknown[]) {
      for await (const page of pagesOf(args)) {
        yield* itemsOf(page, shape.items);
      }
    },
    all: async (...args: unknown[]) => {
      const collected: unknown[] = [];
      for await (const page of pagesOf(args)) {
        collected.push(...itemsOf(page, shape.items));
      }
      return collected;
    },
  };
}

/** `args` with `page_token` set on the argument at `index`, leaving the caller's untouched. */
function withToken(args: readonly unknown[], index: number, token: string): unknown[] {
  // Built fresh rather than with `Array.prototype.with`, which throws when the
  // caller left an optional argument at `index` off.
  return Array.from({ length: Math.max(args.length, index + 1) }, (_, i) =>
    i === index ? { ...(args[i] as object | undefined), page_token: token } : args[i],
  );
}

/** The array `field` names on a page; a page without one is not a page of this list. */
function itemsOf(page: unknown, field: string): readonly unknown[] {
  const list = (page as Record<string, unknown> | null)?.[field];
  if (!Array.isArray(list)) {
    throw new TypeError(`Unexpected list response: missing "${field}" array`);
  }
  return list;
}

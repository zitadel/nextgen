import { ZitadelError } from "../../errors";
import { isObject } from "../../json";
import type { Page } from "./types";

/**
 * Walk a cursor-paginated endpoint. `request` performs one page; the
 * response must carry the items under `items` and, while more remain, a
 * `next_page_token`. With `all` the pages are drained in order and `next`
 * is `null`; otherwise one page is fetched and `next` is its token.
 */
export const collectPages = async (
  request: (token?: string) => Promise<unknown>,
  { items, all, token }: Readonly<{ items: string; all: boolean; token?: string }>,
): Promise<Page> => {
  // Accumulated in one array rather than by concatenating each page onto the
  // last: these resources are unbounded, and a wide `--all` would otherwise
  // copy every record once per remaining page.
  const collected: unknown[] = [];
  // A server that returns a cursor it already issued — a bug, a cache — would
  // otherwise have the drain fetch the same page forever behind a spinner that
  // looks like progress.
  const seen = new Set<string>();
  let cursor = token;
  for (;;) {
    const response = await request(cursor);
    if (!isObject(response) || !Array.isArray(response[items])) {
      throw new ZitadelError("E_VALIDATION", `Unexpected list response: missing "${items}" array`, {
        details: { response },
      });
    }
    collected.push(...(response[items] as readonly unknown[]));
    const next =
      typeof response.next_page_token === "string" ? response.next_page_token || null : null;
    if (!all) {
      return { items: collected, next };
    }
    if (!next) {
      return { items: collected, next: null };
    }
    if (seen.has(next)) {
      throw new ZitadelError(
        "E_VALIDATION",
        "The server repeated a page cursor, so --all would never finish",
        {
          hint: "Fetch one page at a time with --limit and --page-token, and report the repeated cursor.",
          details: { page_token: next, pages_fetched: seen.size + 1 },
        },
      );
    }
    seen.add(next);
    cursor = next;
  }
};

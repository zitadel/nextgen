import { nextToken, pages } from "@zitadel/api/runtime/paging";

import { ZitadelError } from "../../errors";
import { isObject } from "../../json";
import type { Page } from "./types";

/**
 * One page of a cursor-paginated endpoint, or with `all` every page in order.
 * `request` fetches the page a cursor names, starting at `token`. A page holds
 * its items under `items`, or is the array itself when `items` is unset, and
 * the cursor to the next page under `nextPageToken`. `next` is that cursor, or
 * `null` once `all` has read the last page.
 */
export const collectPages = async (
  request: (token?: string) => Promise<unknown>,
  {
    items,
    all,
    token,
    nextPageToken,
  }: Readonly<{ items?: string; all: boolean; token?: string; nextPageToken: string }>,
): Promise<Page> => {
  const next = (response: unknown) => nextToken(response, nextPageToken);
  // Accumulated in one array rather than by concatenating each page onto the
  // last: these resources are unbounded, and a wide `--all` would otherwise
  // copy every record once per remaining page.
  const collected: unknown[] = [];
  for await (const response of pages(request, {
    start: token,
    next,
  })) {
    collected.push(...itemsOf(response, items));
    if (!all) {
      return { items: collected, next: next(response) ?? null };
    }
  }
  return { items: collected, next: null };
};

/** A page's items: the array `items` names, or the body when it is the collection itself. */
function itemsOf(response: unknown, items: string | undefined): readonly unknown[] {
  const page = items === undefined ? response : isObject(response) ? response[items] : undefined;
  if (!Array.isArray(page)) {
    throw new ZitadelError(
      "E_VALIDATION",
      items === undefined
        ? "Unexpected list response: expected an array"
        : `Unexpected list response: missing "${items}" array`,
      { details: { response } },
    );
  }
  return page;
}

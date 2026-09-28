import type { Json, QueryParts, WireConventions } from "./types";

/**
 * The wire vocabulary this platform uses: cursor pagination named as
 * [ADR 027](../../../../../../docs/adrs/027-cursor-based-pagination.md)
 * defines it, and the structured-query body shape of
 * [ADR 031](../../../../../../docs/adrs/031-openapi-querying.md).
 *
 * These live behind {@link WireConventions} rather than inline in the list
 * operation so the factory stays honest about what it assumes: a platform
 * whose cursor is `next_cursor`, or whose filters are a map rather than a
 * list, overrides the vocabulary instead of forking the factory.
 */
export const DEFAULT_WIRE: WireConventions = {
  limit: "limit",
  pageToken: "page_token",
  nextPageToken: "next_page_token",
  query: ({ paging, filters, sorting }: QueryParts): Json => ({
    ...paging,
    ...(sorting && { sorting }),
    ...(filters.length > 0 && { filter: filters }),
  }),
};

/** The caller's overrides over {@link DEFAULT_WIRE}. */
export const wireOf = (overrides: Partial<WireConventions> | undefined): WireConventions => ({
  ...DEFAULT_WIRE,
  ...overrides,
});

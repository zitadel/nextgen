import { describe, expect, it } from "vitest";

import { pagingParameters, pagingSource } from "./operations";

/** Signatures as orval writes them, one per argument order a paged function can have. */
const endpoints = `
export const listThings = async (params?: ListThingsParams, options?: Parameters<typeof customFetch>[1]): Promise<ListThings200> => {
export const listUserThings = async (userId: string,
    params?: ListUserThingsParams, options?: Parameters<typeof customFetch>[1]): Promise<ListUserThings200> => {
export const queryThings = async (queryThingsBody: QueryThingsBody,
    params: QueryThingsParams, options?: Parameters<typeof customFetch>[1]): Promise<QueryThings200> => {
export const searchThings = async (params: SearchThingsParams,
    searchThingsBody?: SearchThingsBody, options?: Parameters<typeof customFetch>[1]): Promise<SearchThings200> => {
export const sortThings = async (order: ("asc" | "desc")[],
    params?: SortThingsParams, options?: Parameters<typeof customFetch>[1]): Promise<SortThings200> => {
export const watchThings = async (onPage: (page: Page, params: Cursor) => void,
    labels: Record<string, string>, params?: WatchThingsParams): Promise<WatchThings200> => {
export const listWidgets = async (params?: ListWidgetsParams, options?: Parameters<typeof customFetch>[1]): Promise<ListWidgets200> => {
export const brokenThings = async (params?: BrokenThingsParams
`;

describe("pagingParameters", () => {
  it.each([
    ["the query parameters alone", "listThings", "query", ["params", "options"], "params"],
    [
      "the query parameters after a path parameter",
      "listUserThings",
      "query",
      ["userId", "params", "options"],
      "params",
    ],
    [
      "the body before the query parameters",
      "queryThings",
      "body",
      ["queryThingsBody", "params", "options"],
      "queryThingsBody",
    ],
    [
      "the body after required query parameters",
      "searchThings",
      "body",
      ["params", "searchThingsBody", "options"],
      "searchThingsBody",
    ],
    [
      "the query parameters after a type in brackets",
      "sortThings",
      "query",
      ["order", "params", "options"],
      "params",
    ],
    [
      "the query parameters after types with commas inside",
      "watchThings",
      "query",
      ["onPage", "labels", "params"],
      "params",
    ],
  ] as const)("finds %s", (_, id, token, names, carrier) => {
    expect(pagingParameters(endpoints, { id, paging: { token, items: "things" } })).toEqual({
      names,
      carrier,
    });
  });

  it("refuses an operation orval wrote no function for", () => {
    expect(() =>
      pagingParameters(endpoints, { id: "listOthers", paging: { token: "query", items: "x" } }),
    ).toThrow("listOthers has no generated function");
  });

  it("refuses a function whose parameter list never closes", () => {
    expect(() =>
      pagingParameters(endpoints, { id: "brokenThings", paging: { token: "query", items: "x" } }),
    ).toThrow("brokenThings has an unterminated parameter list");
  });

  it("refuses an operation with no argument for its page_token", () => {
    expect(() =>
      pagingParameters(endpoints, { id: "listThings", paging: { token: "body", items: "things" } }),
    ).toThrow("listThings has no argument to carry its page_token");
  });
});

describe("pagingSource", () => {
  it("reads a list under a plain name as a property", () => {
    const source = pagingSource(
      [{ id: "listThings", paging: { token: "query", items: "things" } }],
      endpoints,
    );

    expect(source).toContain('items: (page: Page<"listThings">) => page.things,');
  });

  it("reads a list under a name that is no identifier by its quoted name", () => {
    const source = pagingSource(
      [{ id: "listThings", paging: { token: "query", items: "thing-list" } }],
      endpoints,
    );

    expect(source).toContain('items: (page: Page<"listThings">) => page["thing-list"],');
  });

  it("keys an operation by the name of its function", () => {
    const source = pagingSource(
      [{ id: "ListWidgets", paging: { token: "query", items: "widgets" } }],
      endpoints,
    );

    expect(source).toContain(
      '  listWidgets: {\n    items: (page: Page<"listWidgets">) => page.widgets,',
    );
  });

  it("sets page_token on the argument that carries it, typed by the function's parameters", () => {
    const source = pagingSource(
      [{ id: "listUserThings", paging: { token: "query", items: "things" } }],
      endpoints,
    );

    expect(source).toContain(
      'withToken: ([userId, params, options]: Parameters<(typeof endpoints)["listUserThings"]>, page_token: string): Parameters<(typeof endpoints)["listUserThings"]> => [userId, { ...params, page_token }, options],',
    );
  });

  it("leaves out an operation that does not page", () => {
    const source = pagingSource([{ id: "listThings", paging: null }], endpoints);

    expect(source).not.toContain("listThings");
  });
});

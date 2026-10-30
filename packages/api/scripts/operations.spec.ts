import { describe, expect, it } from "vitest";

import { pagingArgument } from "./operations";

/** An operation that pages its `page_token` through `token`. */
function operation(
  path: string,
  token: "query" | "body",
  {
    body = null,
    query = "optional",
  }: { body?: "required" | "optional" | null; query?: "required" | "optional" } = {},
) {
  return {
    id: "listThings",
    path,
    parameters: [
      ...[...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => ({
        name: name ?? "",
        in: "path",
        required: true,
      })),
      { name: "page_token", in: "query", required: query === "required" },
    ],
    body,
    paging: { token, items: "things" },
  };
}

describe("pagingArgument", () => {
  it.each([
    ["the query after the path parameters", operation("/users/{user_id}/things", "query"), 1],
    ["the query after a required body", operation("/things", "query", { body: "required" }), 1],
    [
      "the required query before an optional body",
      operation("/things", "query", { body: "optional", query: "required" }),
      0,
    ],
    ["the body before the query", operation("/things/query", "body", { body: "required" }), 0],
    [
      "an optional body after the required query",
      operation("/things/query", "body", { body: "optional", query: "required" }),
      1,
    ],
  ])("finds %s", (_, op, expected) => {
    expect(pagingArgument(op)).toBe(expected);
  });

  it("refuses an operation with no argument for its page_token", () => {
    expect(() => pagingArgument(operation("/things", "body"))).toThrow(
      "listThings has no argument to carry its page_token",
    );
  });
});

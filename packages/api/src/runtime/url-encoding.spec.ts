import { afterEach, expect, test } from "vitest";

import { getGetSchemaByIdUrl, getGetUserByIDUrl } from "../generated/endpoints/zitadelNextGen";
import { setProxyPath } from "./base-url";

afterEach(() => setProxyPath(""));

// The two halves of orval's `urlEncodeParameters`, pinned together because
// they regressed in opposite directions: 8.10 encoded neither, and turning the
// flag on before 8.37 encoded both — which mangles `http://localhost:3000`
// into `http%3A%2F%2Flocalhost%3A3000` (orval-labs/orval#4178).
test("a path parameter is encoded and the base URL is not", () => {
  setProxyPath("http://localhost:3000");

  expect(getGetUserByIDUrl("usr_01")).toBe("http://localhost:3000/users/usr_01");
});

// A schema's id is its `$id`, usually a URL. Sent raw, the `//` collapses on a
// redirect and the request 404s — the bug behind #1272.
test("a schema id that is a URL survives as one path segment", () => {
  const id = "https://nextgen.com/api/schemas/default-human-user.json";

  expect(getGetSchemaByIdUrl(id)).toBe(
    "/schemas/https%3A%2F%2Fnextgen.com%2Fapi%2Fschemas%2Fdefault-human-user.json",
  );
});

test.each([
  ["urn:example:human", "urn%3Aexample%3Ahuman"],
  ["with space", "with%20space"],
  ["a/b", "a%2Fb"],
])("encodes %j", (id, encoded) => {
  expect(getGetSchemaByIdUrl(id)).toBe(`/schemas/${encoded}`);
});

import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { getGetSchemaUrl, getGetUserUrl } from "../generated/endpoints/zitadelNextGen";
import { API_PREFIX, apiBaseUrl } from "./base-url";

// The spec's servers URL is the contract (ADR 077), and API_PREFIX what every
// TypeScript client puts in front of an operation's path; the Go client's
// PathPrefix has the same test. A change to one alone would leave the others
// behind.
test("API_PREFIX is the spec's server URL", () => {
  const spec = readFileSync(
    new URL("../../../../apps/api/api/openapi/openapi-spec.yaml", import.meta.url),
    "utf8",
  );

  expect(spec.match(/^servers:\n(?:\s*#.*\n)*\s*- url: (\S+)/m)?.[1]).toBe(API_PREFIX);
});

// A generated URL is the operation's path alone: the server and the API prefix
// are the client's, added by the transport (fetch.spec.ts).
test("a generated URL is the operation's path, with no server in front", () => {
  expect(getGetUserUrl("usr_01")).toBe("/users/usr_01");
});

// A schema's id is its `$id`, usually a URL. Sent raw, the `//` collapses on a
// redirect and the request 404s — the bug behind #1272.
test("a schema id that is a URL survives as one path segment", () => {
  const id = "https://zitadel.com/schemas/v1/default-human-user.json";

  expect(getGetSchemaUrl(id)).toBe(
    "/schemas/https%3A%2F%2Fzitadel.com%2Fschemas%2Fv1%2Fdefault-human-user.json",
  );
});

test.each([
  ["urn:example:human", "urn%3Aexample%3Ahuman"],
  ["with space", "with%20space"],
  ["a/b", "a%2Fb"],
])("encodes %j", (id, encoded) => {
  expect(getGetSchemaUrl(id)).toBe(`/schemas/${encoded}`);
});

test.each([
  ["", API_PREFIX],
  ["/", API_PREFIX],
  ["/__nextgen", "/__nextgen/api/v1"],
  ["http://localhost:8080", "http://localhost:8080/api/v1"],
  ["http://localhost:8080/", "http://localhost:8080/api/v1"],
  ["http://localhost:8080/api/v1", "http://localhost:8080/api/v1"],
  ["http://localhost:8080/api/v1/", "http://localhost:8080/api/v1"],
  ["https://zitadel.example.com/zitadel", "https://zitadel.example.com/zitadel/api/v1"],
  ["https://zitadel.example.com/xapi/v1", "https://zitadel.example.com/xapi/v1/api/v1"],
])("puts the prefix after %j once", (base, expected) => {
  expect(apiBaseUrl(base)).toBe(expected);
});

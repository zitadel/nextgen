import { readFileSync } from "node:fs";

import { afterEach, expect, test } from "vitest";

import { getGetSchemaByIdUrl, getGetUserByIDUrl } from "../generated/endpoints/zitadelNextGen";
import { API_PREFIX, apiBaseUrl, getApiBaseUrl, getProxyPath, setProxyPath } from "./base-url";

afterEach(() => setProxyPath(""));

// The spec's servers URL is the contract (ADR 077), and API_PREFIX what every
// TypeScript client puts in front of an operation's path; the Go client's
// PathPrefix has the same test. A change to one alone would leave the others
// behind.
test("API_PREFIX is the spec's server URL", () => {
  const spec = readFileSync(
    new URL("../../../../api/openapi/openapi-spec.yaml", import.meta.url),
    "utf8",
  );

  expect(spec.match(/^servers:\n(?:\s*#.*\n)*\s*- url: (\S+)/m)?.[1]).toBe(API_PREFIX);
});

test("getProxyPath returns empty string by default", () => {
  expect(getProxyPath()).toBe("");
});

// The two halves of orval's `urlEncodeParameters`, pinned together because
// they regressed in opposite directions: 8.10 encoded neither, and turning the
// flag on before 8.37 encoded both — which mangles `http://localhost:3000`
// into `http%3A%2F%2Flocalhost%3A3000` (orval-labs/orval#4178).
test("a path parameter is encoded and the base URL is not", () => {
  setProxyPath("http://localhost:3000");

  expect(getGetUserByIDUrl("usr_01")).toBe("http://localhost:3000/api/v1/users/usr_01");
});

// A schema's id is its `$id`, usually a URL. Sent raw, the `//` collapses on a
// redirect and the request 404s — the bug behind #1272.
test("a schema id that is a URL survives as one path segment", () => {
  const id = "https://zitadel.com/schemas/v1/default-human-user.json";

  expect(getGetSchemaByIdUrl(id)).toBe(
    "/api/v1/schemas/https%3A%2F%2Fzitadel.com%2Fschemas%2Fv1%2Fdefault-human-user.json",
  );
});

test.each([
  ["urn:example:human", "urn%3Aexample%3Ahuman"],
  ["with space", "with%20space"],
  ["a/b", "a%2Fb"],
])("encodes %j", (id, encoded) => {
  expect(getGetSchemaByIdUrl(id)).toBe(`/api/v1/schemas/${encoded}`);
});

test("the operations follow the proxy path and the API prefix", () => {
  setProxyPath("/__nextgen");

  expect(getApiBaseUrl()).toBe("/__nextgen/api/v1");
  expect(getGetUserByIDUrl("usr_01")).toBe("/__nextgen/api/v1/users/usr_01");
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

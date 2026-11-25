import { describe, expect, test } from "vitest";

import { OpenApiSpec } from "./spec";

const schemes = {
  oauth2: { type: "oauth2" },
  sessionCookie: { type: "apiKey", in: "cookie" },
};

function names(spec: OpenApiSpec): string[] {
  return spec.operations().map((operation) => {
    return operation.name;
  });
}

describe("OpenApiSpec", () => {
  test("names each operation as its method in capitals and its path as the spec writes it", () => {
    const spec = new OpenApiSpec({
      paths: {
        "/users/{user_id}": {
          get: { operationId: "getUser" },
          patch: { operationId: "patchUser" },
          parameters: [],
        },
        "/users": { post: { operationId: "createUser" } },
      },
    });

    expect(names(spec)).toEqual(["GET /users/{user_id}", "PATCH /users/{user_id}", "POST /users"]);
  });

  test("ignores path item members that are not operations", () => {
    const spec = new OpenApiSpec({ paths: { "/a": { summary: "x", parameters: [] } } });

    expect(spec.operations()).toEqual([]);
  });

  test("reads the operation id", () => {
    const spec = new OpenApiSpec({ paths: { "/a": { get: { operationId: "getA" } } } });

    expect(spec.operations()[0]?.id).toBe("getA");
  });

  test("refuses an operation without an operation id, which Schemathesis could not select", () => {
    const spec = new OpenApiSpec({ paths: { "/a": { get: {} } } });

    expect(() => spec.operations()).toThrow("GET /a has no operationId");
  });

  test("counts the security alternatives of an operation, falling back to the document's", () => {
    const spec = new OpenApiSpec({
      components: { securitySchemes: schemes },
      security: [{ oauth2: [] }],
      paths: {
        "/a": { get: { operationId: "a" } },
        "/b": { get: { operationId: "b", security: [] } },
        "/c": { get: { operationId: "c", security: [{ oauth2: [] }, { sessionCookie: [] }] } },
      },
    });

    expect(
      spec.operations().map((operation) => {
        return operation.alternatives;
      }),
    ).toEqual([1, 0, 2]);
  });

  test("reads the prefix from the first server", () => {
    expect(new OpenApiSpec({ servers: [{ url: "/api/v1" }], paths: {} }).prefix).toBe("/api/v1");
    expect(new OpenApiSpec({ paths: {} }).prefix).toBeUndefined();
  });

  test("parses the document the server serves", () => {
    const text = '{"paths":{"/a":{"get":{"operationId":"a"}}}}';

    expect(OpenApiSpec.parse(text).operations()).toHaveLength(1);
  });

  describe("families", () => {
    const spec = new OpenApiSpec({
      components: { securitySchemes: schemes },
      security: [{ oauth2: [] }],
      paths: {
        "/readyz": { get: { operationId: "a", security: [] } },
        "/projects": { get: { operationId: "b" } },
        "/users/me": { get: { operationId: "c", security: [{ sessionCookie: [] }] } },
        "/flow/{id}": {
          get: { operationId: "d", security: [{ oauth2: [] }, { sessionCookie: [] }] },
        },
        "/sessions/me": { delete: { operationId: "e", security: [{ sessionCookie: [] }] } },
      },
    });

    test.each([
      ["GET /readyz", "public"],
      ["GET /projects", "management"],
      ["GET /users/me", "session"],
      ["GET /flow/{id}", "management"],
      ["DELETE /sessions/me", "logout"],
    ])("puts %s in %s", (name, family) => {
      const found = spec.operations().find((operation) => {
        return operation.name === name;
      });

      expect(found?.family).toBe(family);
    });

    test("lists one family's operations", () => {
      expect(
        spec.operationsOf("management").map((operation) => {
          return operation.name;
        }),
      ).toEqual(["GET /flow/{id}", "GET /projects"]);
    });

    test("refuses a security scheme it cannot supply a credential for", () => {
      const unknown = new OpenApiSpec({
        paths: { "/a": { get: { operationId: "a", security: [{ mystery: [] }] } } },
      });

      expect(() => unknown.operations()).toThrow('security scheme "mystery"');
    });

    test("names the scheme of each kind", () => {
      expect(spec.schemeNamed("bearer")).toBe("oauth2");
      expect(spec.schemeNamed("cookie")).toBe("sessionCookie");
    });

    test("refuses to guess when there is not exactly one scheme of a kind", () => {
      const none = new OpenApiSpec({ paths: {} });

      expect(() => none.schemeNamed("bearer")).toThrow("expected one bearer security scheme");
    });
  });
});

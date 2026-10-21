import { describe, expect, it } from "vitest";

import {
  findOperations,
  OPERATIONS,
  pathParameterNames,
  resolveTarget,
  uncallable,
} from "../../../../src/lib/api/operations";
import { schemaOf } from "../../../../src/lib/api/request";

const byId = (id: string) => {
  const operation = OPERATIONS.find((candidate) => candidate.id === id);
  if (!operation) {
    throw new Error(`no operation ${id}`);
  }
  return operation;
};

describe("the operation table", () => {
  it("names every operation once", () => {
    const ids = OPERATIONS.map((operation) => operation.id.toLowerCase());

    expect(new Set(ids).size).toBe(ids.length);
  });

  // A field is typed by the schema orval generates for the operation; a name
  // it cannot find would leave every field of that operation untyped.
  it("finds the generated body schema of every operation that takes a body", () => {
    const missing = OPERATIONS.filter(
      (operation) => operation.body !== null && schemaOf(operation, "Body") === undefined,
    ).map((operation) => operation.id);

    expect(missing).toEqual([]);
  });

  it("finds the generated query schema of every operation with a query parameter", () => {
    const missing = OPERATIONS.filter(
      (operation) =>
        operation.parameters.some((parameter) => parameter.in === "query") &&
        schemaOf(operation, "QueryParams") === undefined,
    ).map((operation) => operation.id);

    expect(missing).toEqual([]);
  });

  // A field goes to the query when its name is a query parameter and to the
  // body otherwise, which only works while no name is both.
  it("has no query parameter named like a top-level field of the same operation's body", () => {
    const clashes = OPERATIONS.flatMap((operation) => {
      const shape = (schemaOf(operation, "Body") as { shape?: Record<string, unknown> } | undefined)
        ?.shape;
      return operation.parameters
        .filter(
          (parameter) => parameter.in === "query" && shape && Object.hasOwn(shape, parameter.name),
        )
        .map((parameter) => `${operation.id}.${parameter.name}`);
    });

    expect(clashes).toEqual([]);
  });
});

describe("resolveTarget", () => {
  it("finds an operation by its id, in any case", () => {
    expect(resolveTarget("getuserbyid").operation.id).toBe("GetUserByID");
  });

  it("suggests the operation a typo meant", () => {
    expect(() => resolveTarget("querUsers")).toThrow(
      expect.objectContaining({
        code: "E_VALIDATION",
        hint: expect.stringContaining("queryUsers"),
      }),
    );
  });

  it("refuses a method that is not the operation's", () => {
    expect(() => resolveTarget("queryUsers", "GET")).toThrow(
      "queryUsers is POST /users/query, not GET",
    );
  });

  it("finds an operation by a path, reading its parameters from it", () => {
    const target = resolveTarget("/users/user_1/passkeys");

    expect(target.operation.id).toBe("listUserPasskeys");
    expect(target.pathValues).toEqual({ user_id: "user_1" });
  });

  it("decodes an escaped path segment", () => {
    expect(resolveTarget("/variables/MY%20VAR").pathValues).toEqual({ variable_name: "MY VAR" });
  });

  it("keeps a path's query string apart", () => {
    const target = resolveTarget("/events?category=auth&category=session");

    expect(target.operation.id).toBe("listEvents");
    expect(target.query.getAll("category")).toEqual(["auth", "session"]);
  });

  it("prefers the template whose segments are spelled out", () => {
    expect(resolveTarget("/users/me").operation.id).toBe("getMyUser");
  });

  it("takes a path's only method without -X", () => {
    expect(resolveTarget("/users/query").operation.id).toBe("queryUsers");
  });

  it("takes GET among a path's methods without -X", () => {
    expect(resolveTarget("/users/user_1").operation.id).toBe("GetUserByID");
  });

  it("takes the method -X names", () => {
    expect(resolveTarget("/users/user_1", "DELETE").operation.id).toBe("DeleteUserByID");
  });

  it("asks for -X where a path has several methods and no GET", () => {
    expect(() => resolveTarget("/variables", "PUT")).toThrow(
      "/variables takes GET, PATCH, not PUT",
    );
  });

  it("refuses a path no operation has", () => {
    expect(() => resolveTarget("/nothing/here")).toThrow("No operation has the path /nothing/here");
  });

  it("ignores a trailing slash", () => {
    expect(resolveTarget("/users/query/").operation.id).toBe("queryUsers");
  });
});

describe("uncallable", () => {
  it("lets the CLI call what a project secret authenticates", () => {
    expect(uncallable(byId("queryUsers"))).toBeUndefined();
  });

  it("lets the CLI call what needs no credential", () => {
    expect(uncallable(byId("getHealth"))).toBeUndefined();
  });

  it("refuses what only an end user's session authenticates", () => {
    expect(uncallable(byId("getMyUser"))).toMatch(/session cookie/);
  });

  it("refuses what reads a cookie only a browser carries", () => {
    expect(uncallable(byId("getFlowStep"))).toMatch(/_zflow cookie/);
  });
});

describe("pathParameterNames", () => {
  it("lists the parameters in the order the path has them", () => {
    expect(pathParameterNames(byId("finishUserPasskeyRegistration"))).toEqual([
      "user_id",
      "registration_id",
    ]);
  });
});

describe("findOperations", () => {
  it("finds an operation by a word of its id, path, summary or tag, in any case", () => {
    expect(findOperations({ filter: "PASSKEY" }).map((operation) => operation.id)).toEqual([
      "listUserPasskeys",
      "beginUserPasskeyRegistration",
      "finishUserPasskeyRegistration",
    ]);
  });

  it("keeps to one tag", () => {
    expect(findOperations({ tag: "system" }).map((operation) => operation.id)).toEqual([
      "getHealth",
      "getLive",
      "getReady",
    ]);
  });

  it("lists every operation without a filter", () => {
    expect(findOperations({})).toEqual(OPERATIONS);
  });
});

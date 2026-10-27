import { describe, expect, it } from "vitest";

import { resolveTarget } from "../../../../src/lib/api/operations";
import { buildRequest, pathValuesOf, urlOf } from "../../../../src/lib/api/request";

/** The request for `ref` with `fields`, every path parameter already given. */
const requestFor = (
  ref: string,
  fields: string[] = [],
  options: { input?: Record<string, unknown>; projectId?: string; positionals?: string[] } = {},
) => {
  const target = resolveTarget(ref);
  const { values } = pathValuesOf(target, options.positionals ?? [], options.projectId);
  return buildRequest({
    target,
    pathValues: values,
    fields,
    input: options.input,
    projectId: options.projectId,
  });
};

describe("pathValuesOf", () => {
  it("reads the positionals in the path's order", () => {
    const target = resolveTarget("finishUserPasskeyRegistration");

    expect(pathValuesOf(target, ["user_1", "reg_1"], undefined)).toEqual({
      values: { user_id: "user_1", registration_id: "reg_1" },
      missing: [],
    });
  });

  it("names the parameters still missing", () => {
    const target = resolveTarget("finishUserPasskeyRegistration");

    expect(pathValuesOf(target, ["user_1"], undefined).missing).toEqual(["registration_id"]);
  });

  it("fills a project_id left out with the CLI's project", () => {
    expect(pathValuesOf(resolveTarget("getProject"), [], "proj_1").values).toEqual({
      project_id: "proj_1",
    });
  });

  it("refuses more positionals than the path has parameters", () => {
    expect(() => pathValuesOf(resolveTarget("getSession"), ["a", "b"], undefined)).toThrow(
      "getSession takes 1 path parameter (session_id), but got 2",
    );
  });

  it("refuses a positional when the path already names its parameters", () => {
    expect(() => pathValuesOf(resolveTarget("/sessions/s_1"), ["s_2"], undefined)).toThrow(
      /already names session_id/,
    );
  });
});

describe("buildRequest", () => {
  it("fills the path, escaping each value", () => {
    expect(requestFor("getVariable", [], { positionals: ["A/B"], projectId: "p" }).path).toBe(
      "/variables/A%2FB",
    );
  });

  it("sends a field the operation declares as a query parameter in the query", () => {
    expect(requestFor("listSchemas", ["limit=5"], { projectId: "p" }).query).toContainEqual([
      "limit",
      "5",
    ]);
  });

  it("types a query field by the operation's schema", () => {
    expect(() => requestFor("listSchemas", ["limit=five"], { projectId: "p" })).toThrow(
      '--field limit expects an integer, got "five"',
    );
  });

  it("repeats a list parameter once per field", () => {
    const { query } = requestFor("listEvents", ["category=auth", "category=session"], {
      projectId: "p",
    });

    expect(query.filter(([name]) => name === "category")).toEqual([
      ["category", "auth"],
      ["category", "session"],
    ]);
  });

  it("takes a whole list parameter as JSON", () => {
    const { query } = requestFor("listEvents", ['category:=["auth","admin"]'], { projectId: "p" });

    expect(query.filter(([name]) => name === "category")).toEqual([
      ["category", "auth"],
      ["category", "admin"],
    ]);
  });

  it("lets a field replace the value the path's query string gave", () => {
    const { query } = requestFor("/schemas?limit=1", ["limit=7"], { projectId: "p" });

    expect(query.filter(([name]) => name === "limit")).toEqual([["limit", "7"]]);
  });

  it("puts any other field into the body by its dot path, typed by the body's schema", () => {
    expect(requestFor("queryUsers", ["limit=5", "sorting.field=created_at"]).body).toEqual({
      limit: 5,
      sorting: { field: "created_at" },
    });
  });

  it("takes a body value as JSON with :=", () => {
    expect(
      requestFor("queryUsers", [
        'filter:=[{"field":"status","operation":"equals","value":"active"}]',
      ]).body,
    ).toEqual({ filter: [{ field: "status", operation: "equals", value: "active" }] });
  });

  it("lays the fields over --input", () => {
    expect(
      requestFor("queryUsers", ["limit=5"], { input: { limit: 1, sorting: { field: "id" } } }).body,
    ).toEqual({ limit: 5, sorting: { field: "id" } });
  });

  it("refuses a name the body does not have, naming the ones it does", () => {
    expect(() => requestFor("createTeam", ["nmae=Support"], { projectId: "p" })).toThrow(
      expect.objectContaining({ message: "--field nmae names no field of this body" }),
    );
  });

  it("sends an empty document for a body the operation requires and nothing gave", () => {
    expect(requestFor("queryUsers").body).toEqual({});
  });

  it("sends no body for an operation that takes none", () => {
    expect(requestFor("getLive")).not.toHaveProperty("body");
  });

  it("refuses --input for an operation that takes no body", () => {
    expect(() => requestFor("getLive", [], { input: {} })).toThrow(
      "getLive takes no body, but --input gave one",
    );
  });

  it("refuses a field an operation without a body has no query parameter for", () => {
    expect(() => requestFor("GetUserByID", ["nope=1"], { positionals: ["user_1"] })).toThrow(
      expect.objectContaining({
        message: "GetUserByID takes no body, and nope is none of its query parameters",
        hint: "Its query parameters: team_id.",
      }),
    );
  });

  it("refuses a path parameter given as a field", () => {
    expect(() =>
      requestFor("GetUserByID", ["user_id=user_1"], { positionals: ["user_1"] }),
    ).toThrow("user_id is a path parameter of GetUserByID; give it as an argument");
  });

  it("fills a required project_id the caller left out", () => {
    expect(requestFor("createTeam", ["name=Support"], { projectId: "proj_1" }).query).toEqual([
      ["project_id", "proj_1"],
    ]);
  });

  it("keeps a project_id the caller gave", () => {
    expect(
      requestFor("createTeam", ["name=Support", "project_id=proj_2"], { projectId: "proj_1" })
        .query,
    ).toEqual([["project_id", "proj_2"]]);
  });

  it("leaves an optional project_id to the server", () => {
    expect(requestFor("queryUsers", [], { projectId: "proj_1" }).query).toEqual([]);
  });
});

describe("urlOf", () => {
  it("joins the server, the path and the query", () => {
    const request = requestFor("listSchemas", ["limit=5"], { projectId: "p 1" });

    expect(urlOf("http://localhost:8080/", request)).toBe(
      "http://localhost:8080/schemas?limit=5&project_id=p+1",
    );
  });
});

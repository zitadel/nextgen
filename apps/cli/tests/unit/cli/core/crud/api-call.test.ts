import { Readable } from "node:stream";

import { describe, expect } from "vitest";

import { Operation } from "@/lib/backend";
import { ApiCall } from "@/cli/core/crud/api-call";
import { it } from "@tests/fixtures";
import { rejectionOf, thrownBy } from "@tests/helpers/thrown-value";

/** What a refusal suggests: the run again. */
const RETRY = { id: "setup" } as const;

const resolveTarget = (ref: string, method?: string) => Operation.named(ref, method);

/** The request for `ref` with `fields`, every path parameter already given. */
const requestFor = (
  ref: string,
  fields: string[] = [],
  options: { input?: Record<string, unknown>; projectId?: string; positionals?: string[] } = {},
) => {
  const target = resolveTarget(ref);
  const call = ApiCall.to(target);
  const { values } = call.pathValues(options.positionals ?? [], options.projectId);
  return call.fill(
    call.request({
      fields,
      input: options.input,
      projectId: options.projectId,
    }),
    values,
  );
};

describe("ApiCall.pathValues", () => {
  it("reads the positionals in the path's order", () => {
    const target = resolveTarget("completeUserPasskeyRegistration");

    expect(ApiCall.to(target).pathValues(["user_1", "reg_1"], undefined)).toEqual({
      values: { user_id: "user_1", registration_id: "reg_1" },
      missing: [],
    });
  });

  it("sends an id trimmed, as the id arguments of the resource commands do", () => {
    const target = resolveTarget("getSession");

    expect(ApiCall.to(target).pathValues(["  sess_1\t"], undefined).values).toEqual({
      session_id: "sess_1",
    });
  });

  it("names the parameters still missing", () => {
    const target = resolveTarget("completeUserPasskeyRegistration");

    expect(ApiCall.to(target).pathValues(["user_1"], undefined).missing).toEqual([
      "registration_id",
    ]);
  });

  it("fills a project_id left out with the CLI's project", () => {
    expect(ApiCall.to(resolveTarget("getProject")).pathValues([], "proj_1").values).toEqual({
      project_id: "proj_1",
    });
  });

  it("refuses more positionals than the path has parameters", () => {
    expect(() => ApiCall.to(resolveTarget("getSession")).pathValues(["a", "b"], undefined)).toThrow(
      "getSession takes 1 path parameter (session_id), but got 2",
    );
  });

  it.each([
    ["getSession", ["a", "b"], "getSession takes 1 path parameter (session_id), but got 2"],
    [
      "completeUserPasskeyRegistration",
      ["a", "b", "c"],
      "completeUserPasskeyRegistration takes 2 path parameters (user_id, registration_id), but got 3",
    ],
  ])("counts the path parameters of %s in the singular or plural", (operation, given, message) => {
    expect(() => ApiCall.to(resolveTarget(operation)).pathValues(given, undefined)).toThrow(
      message,
    );
  });

  it.each([
    ["a dot segment", ".."],
    ["a single dot", "."],
    ["an empty value", ""],
    ["a control character", "a\u0007b"],
  ])("refuses %s as a path value", (_what, value) => {
    expect(() => ApiCall.to(resolveTarget("getSession")).pathValues([value], undefined)).toThrow(
      /Invalid session_id/,
    );
  });

  it("refuses a dot segment given in the path", () => {
    expect(() => ApiCall.to(resolveTarget("/sessions/..")).pathValues([], undefined)).toThrow(
      /Invalid session_id/,
    );
  });

  it("refuses a positional when the path already names its parameters", () => {
    expect(() => ApiCall.to(resolveTarget("/sessions/s_1")).pathValues(["s_2"], undefined)).toThrow(
      /already names session_id/,
    );
  });
});

describe("ApiCall.request", () => {
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

  it("lays the fields over --file", () => {
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

  it("refuses --file for an operation that takes no body", () => {
    expect(() => requestFor("getLive", [], { input: {} })).toThrow(
      "getLive takes no body, but --file gave one",
    );
  });

  it("refuses a field an operation without a body has no query parameter for", () => {
    expect(() => requestFor("getUser", ["nope=1"], { positionals: ["user_1"] })).toThrow(
      expect.objectContaining({
        message: "getUser takes no body, and nope is none of its query parameters",
        hint: "Its query parameters: team_id.",
      }),
    );
  });

  it("refuses a path parameter given as a field", () => {
    expect(() => requestFor("getUser", ["user_id=user_1"], { positionals: ["user_1"] })).toThrow(
      "user_id is a path parameter of getUser; give it as an argument",
    );
  });

  it("tells the reader to give a path parameter after the operation, and names no command", () => {
    const error = thrownBy(() => {
      return requestFor("getUser", ["user_id=user_1"], { positionals: ["user_1"] });
    });

    expect(error).toMatchObject({
      hint: "Give it after the operation, in the order the path declares them.",
    });
    expect(error).not.toHaveProperty("nextCommands", expect.anything());
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

describe("urlOn", () => {
  it("joins the server, the path and the query", () => {
    const request = requestFor("listSchemas", ["limit=5"], { projectId: "p 1" });

    expect(request.operation.urlOn("http://localhost:8080/", request)).toBe(
      "http://localhost:8080/api/v1/schemas?limit=5&project_id=p+1",
    );
  });
});

describe("ApiCall.readInput", () => {
  it("reads a body piped in", async ({ terminal }) => {
    terminal.stdin(Readable.from([Buffer.from('{"a":1}\n')]));

    expect(await ApiCall.readInput("-", RETRY)).toEqual({ a: 1 });
  });

  it("reads a body piped in with a UTF-8 byte-order mark in front of it", async ({ terminal }) => {
    terminal.stdin(
      Readable.from([Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"a":1}\n')])]),
    );

    expect(await ApiCall.readInput("-", RETRY)).toEqual({ a: 1 });
  });

  it("refuses a terminal with nothing piped in, and suggests the run again", async ({
    terminal: _terminal,
  }) => {
    const error = await rejectionOf(() => {
      return ApiCall.readInput("-", RETRY);
    });

    expect(error).toMatchObject({
      code: "E_VALIDATION",
      hint: "Pipe a body in and pass --file -, or pass --file <path>.",
      nextCommands: [{ id: "setup" }],
    });
  });
});

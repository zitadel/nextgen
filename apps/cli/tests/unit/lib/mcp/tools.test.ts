import { describe, expect, it } from "vitest";

import { OPERATIONS, pathParameterNames, uncallable } from "../../../../src/lib/api/operations";
import { schemaOf } from "../../../../src/lib/api/request";
import {
  firstSentence,
  readsOnly,
  requestOf,
  type ToolDefinition,
  toolsFor,
} from "../../../../src/lib/mcp/tools";

const ALL = toolsFor({ writes: true });

const tool = (name: string): ToolDefinition => {
  const found = ALL.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`no tool ${name}`);
  }
  return found;
};

type Listed = {
  required?: string[];
  properties: Record<string, { description?: string; properties?: Record<string, Listed> }>;
};

/** A tool's input schema as `tools/list` shows it. */
const listed = (name: string): Listed =>
  tool(name).inputSchema["~standard"].jsonSchema.input({ target: "draft-2020-12" }) as Listed;

const operation = (id: string) => {
  const found = OPERATIONS.find((candidate) => candidate.id === id);
  if (!found) {
    throw new Error(`no operation ${id}`);
  }
  return found;
};

describe("the tools", () => {
  it("are the operations the CLI can call, each named by its operationId", () => {
    const callable = OPERATIONS.filter((candidate) => uncallable(candidate) === undefined);

    expect(ALL.map(({ name }) => name)).toEqual(callable.map(({ id }) => id));
  });

  it("are only the reads unless writes are allowed", () => {
    const reads = toolsFor({ writes: false });

    expect(reads.map(({ name }) => name)).toContain("queryUsers");
    expect(reads.map(({ name }) => name)).not.toContain("createUser");
    expect(reads.every(({ operation: read }) => readsOnly(read))).toBe(true);
  });

  it("are those of the tags asked for, in any case", () => {
    const tags = new Set(
      toolsFor({ writes: true, tags: ["users"] }).map((each) => each.operation.tag),
    );

    expect([...tags]).toEqual(["Users"]);
  });

  // A path parameter missing from the schema would reach the server as an
  // empty segment.
  it("find the generated schema of every path parameter", () => {
    const missing = ALL.filter(
      (each) =>
        pathParameterNames(each.operation).length > 0 &&
        schemaOf(each.operation, "Params") === undefined,
    ).map(({ name }) => name);

    expect(missing).toEqual([]);
  });

  it("require a path parameter, and leave project_id to the served project", () => {
    expect(listed("GetUserByID").required).toEqual(["user_id"]);
    expect(listed("addOrigin").required ?? []).not.toContain("project_id");
  });

  it("take the body as body, required where the operation requires one", () => {
    expect(listed("createUser").required).toContain("body");
    expect(listed("GetUserByID").properties).not.toHaveProperty("body");
  });

  it("leave out a required body the empty document satisfies, which is then sent as {}", () => {
    expect(listed("queryUsers").required ?? []).not.toContain("body");
    expect(requestOf(operation("queryUsers"), {}, "proj_1").body).toEqual({});
  });

  it("list every description cut to its first sentence", () => {
    const body = listed("queryUsers").properties.body as unknown as Listed;

    expect(body.properties.page_token?.description).toBe(
      "Token to retrieve the next page of results.",
    );
  });

  it("still check a call against the whole schema", async () => {
    const result = await tool("GetUserByID").inputSchema["~standard"].validate({
      user_id: "not a user id",
    });

    expect(result.issues?.length).toBeGreaterThan(0);
  });

  it("mark a read as read-only and a delete as destructive", () => {
    expect(tool("GetUserByID").annotations).toMatchObject({ readOnlyHint: true });
    expect(tool("DeleteUserByID").annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
  });

  it("mark a create as additive and a POST that removes as destructive", () => {
    expect(tool("createUser").annotations).toMatchObject({ destructiveHint: false });
    expect(tool("removeOrigin").annotations).toMatchObject({ destructiveHint: true });
  });

  it("say how a paged operation pages", () => {
    expect(tool("queryUsers").description).toContain("page_token");
    expect(tool("GetUserByID").description).not.toContain("page_token");
  });
});

describe("firstSentence", () => {
  it("ends at the first full stop followed by a new sentence", () => {
    expect(firstSentence("Lists users. Each page holds twenty.")).toBe("Lists users.");
  });

  it("reads only the first paragraph", () => {
    expect(firstSentence("Lists users\nof a project.\n\nMore here.")).toBe(
      "Lists users of a project.",
    );
  });

  it("does not end at an abbreviation, a code span or a link", () => {
    expect(firstSentence("Use a filter, e.g. Status. Then more.")).toBe(
      "Use a filter, e.g. Status.",
    );
    expect(firstSentence("Calls `GET /users. Then` first. More.")).toBe(
      "Calls `GET /users. Then` first.",
    );
    expect(firstSentence("See [the docs. Here](https://x.test/a.b) now. More.")).toBe(
      "See [the docs. Here](https://x.test/a.b) now.",
    );
  });
});

describe("requestOf", () => {
  it("fills and escapes the path, and sends the body", () => {
    const request = requestOf(
      operation("PatchUserByID"),
      { user_id: "user_1 2", body: { attributes: {} } },
      "proj_1",
    );

    expect(request.path).toBe("/users/user_1%202");
    expect(request.body).toEqual({ attributes: {} });
  });

  it("fills a required project_id left out with the served project", () => {
    const request = requestOf(operation("createUser"), { body: {} }, "proj_1");

    expect(request.query).toEqual([["project_id", "proj_1"]]);
  });

  it("leaves an optional project_id out, so the server answers for the caller's own", () => {
    const request = requestOf(operation("queryUsers"), {}, "proj_1");

    expect(request.query).toEqual([]);
    expect(request.body).toEqual({});
  });

  it("repeats a list parameter's name per value", () => {
    const request = requestOf(operation("listEvents"), { category: ["auth", "session"] }, "proj_1");

    expect(request.query.filter(([name]) => name === "category")).toEqual([
      ["category", "auth"],
      ["category", "session"],
    ]);
  });
});

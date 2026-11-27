import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

import { NotFoundError, UnavailableError } from "@/lib/backend/errors";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { SchemaService } from "@/lib/backend/services/schema";
import { answering, answeringPages, refusal } from "@tests/helpers/api-answers";

describe("SchemaService.list", () => {
  it("lists every schema of the project it is bound to, narrowed by the query", async ({
    server,
    client,
  }) => {
    const listed = answeringPages(server, "listSchemas", { schemas: [{ id: "sch_1" }] });

    const schemas = await new SchemaService(client, "proj_1").list({ object_type: "human-user" });

    expect(
      listed.map(({ url }) => {
        return Object.fromEntries(url.searchParams);
      }),
    ).toEqual([{ project_id: "proj_1", object_type: "human-user" }]);
    expect(schemas).toEqual([{ id: "sch_1" }]);
  });

  it("drains past the first page, so a caller sees every schema", async ({ server, client }) => {
    answeringPages(
      server,
      "listSchemas",
      { schemas: [{ id: "sch_2" }] },
      {
        schemas: [{ id: "sch_1" }],
      },
    );

    const schemas = await new SchemaService(client, "proj_1").list();

    expect(schemas).toEqual([{ id: "sch_2" }, { id: "sch_1" }]);
  });
});

describe("SchemaService.page", () => {
  it("reads one page and the cursor to the next", async ({ server, client }) => {
    answering(server, "listSchemas", { schemas: [{ id: "sch_2" }], next_page_token: "t2" });

    const first = await new SchemaService(client, "proj_1").page();

    expect(first.items).toEqual([{ id: "sch_2" }]);
    expect(first.next).toBe("t2");
  });

  it("answers no cursor when the server sent none", async ({ server, client }) => {
    answeringPages(server, "listSchemas", { schemas: [] });

    const first = await new SchemaService(client, "proj_1").page();

    expect(first.next).toBeNull();
  });
});

describe("SchemaService.get", () => {
  it("fetches a revision id directly", async ({ server, client }) => {
    const fetched = answering(server, "getSchema", { id: "sch_1" });

    await expect(new SchemaService(client, "proj_1").get("sch_1")).resolves.toEqual({
      id: "sch_1",
    });
    // Scoped like every other call: a schema id is unique within a project and
    // not across them, so a credential seeing more than one would otherwise
    // resolve it ambiguously.
    expect(
      fetched.map(({ params, url }) => {
        return [params.schema_id, Object.fromEntries(url.searchParams)];
      }),
    ).toEqual([["sch_1", { project_id: "proj_1" }]]);
  });

  it("resolves an object type to its current revision through the list", async ({
    server,
    client,
  }) => {
    answering(server, "getSchema", refusal(404, "schema.not_found"));
    const listed = answeringPages(server, "listSchemas", { schemas: [{ id: "sch_2" }] });

    const schema = await new SchemaService(client, "proj_1").get("human-user");

    expect(schema).toEqual({ id: "sch_2" });
    expect(
      listed.map(({ url }) => {
        return Object.fromEntries(url.searchParams);
      }),
    ).toEqual([
      { project_id: "proj_1", object_type: "human-user", revisions: "latest", limit: "1" },
    ]);
  });

  it("refuses a reference that is neither, saying how to see what the project has", async ({
    server,
    client,
  }) => {
    answering(server, "getSchema", refusal(404, "schema.not_found"));
    answeringPages(server, "listSchemas", { schemas: [] });

    const error = await rejectionOf(() => new SchemaService(client, "proj_1").get("typo"));

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({
      name: "NotFoundError",
      message: 'No schema named "typo"',
      hint: "Run `schema list` to see the object types this project has.",
    });
  });

  it("raises a failure that is not a miss, rather than reading it as an object type", async ({
    server,
    client,
  }) => {
    answering(server, "getSchema", refusal(500, "internal"));

    const error = await rejectionOf(() => new SchemaService(client, "proj_1").get("sch_1"));

    expect(error).toBeInstanceOf(UnavailableError);
    expect(error).toMatchObject({ status: 500 });
  });

  // A revision id that nothing holds says the reference was an object type. A
  // revision the server says is gone says nothing of the kind, and both arrive
  // as the not-found class.
  it("raises a revision the server says is gone, rather than reading it as an object type", async ({
    server,
    client,
  }) => {
    answering(server, "getSchema", refusal(410, "schema.gone", "Gone"));

    const error = await rejectionOf(() => new SchemaService(client, "proj_1").get("sch_1"));

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({
      name: "NotFoundError",
      status: 410,
    });
  });
});

describe("SchemaService.create", () => {
  it("sends the document as given for the project it is bound to", async ({ server, client }) => {
    const published = answering(server, "publishSchema", { id: "sch_1" });
    const input = {
      objectType: "human-user",
      kind: "user-schema" as const,
      metaSchema: "https://zitadel.com/schemas/user/v1",
      "x-auth-methods": {},
    };

    await new SchemaService(client, "proj_1").create(input);

    expect(
      published.map(({ body, url }) => {
        return [body, Object.fromEntries(url.searchParams)];
      }),
    ).toEqual([[input, { project_id: "proj_1" }]]);
  });
});

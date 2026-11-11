import { describe, expect, it, vi } from "vitest";

import { responseFailure } from "@/lib/backend/client";
import { NotFoundError } from "@/lib/backend/errors";
import { SchemaService } from "@/lib/backend/services/schema";
import { type ClientStubs, fakeClient, pagesOf } from "@tests/helpers/fake-client";

/** A service answering `stubs`, bound to one project. */
function service(stubs: ClientStubs): SchemaService {
  return new SchemaService(fakeClient(stubs), "proj_1");
}

describe("SchemaService.list", () => {
  it("lists every schema of the project it is bound to, narrowed by the query", async () => {
    const all = vi.fn(async () => [{ id: "sch_1" }]);

    const schemas = await service({ listSchemas: { all } }).list({ object_type: "human-user" });

    expect(all).toHaveBeenCalledWith({ project_id: "proj_1", object_type: "human-user" });
    expect(schemas).toEqual([{ id: "sch_1" }]);
  });

  it("drains past the first page, so a caller sees every schema", async () => {
    const schemas = await service({
      listSchemas: { all: async () => [{ id: "sch_2" }, { id: "sch_1" }] },
    }).list();

    expect(schemas).toEqual([{ id: "sch_2" }, { id: "sch_1" }]);
  });
});

describe("SchemaService.page", () => {
  it("reads one page and the cursor to the next", async () => {
    const first = await service({
      listSchemas: {
        pages: () =>
          pagesOf(
            { schemas: [{ id: "sch_2" }], next_page_token: "t2" },
            { schemas: [{ id: "sch_1" }], next_page_token: null },
          ),
      },
    }).page();

    expect(first.items).toEqual([{ id: "sch_2" }]);
    expect(first.next).toBe("t2");
  });

  it("answers no cursor when the server sent none", async () => {
    const first = await service({
      listSchemas: { pages: () => pagesOf({ schemas: [], next_page_token: null }) },
    }).page();

    expect(first.next).toBeNull();
  });
});

describe("SchemaService.get", () => {
  it("fetches a revision id directly", async () => {
    const getSchema = vi.fn(async () => ({ id: "sch_1" }));

    await expect(service({ getSchema }).get("sch_1")).resolves.toEqual({ id: "sch_1" });
    // Scoped like every other call: a schema id is unique within a project and
    // not across them, so a credential seeing more than one would otherwise
    // resolve it ambiguously.
    expect(getSchema).toHaveBeenCalledWith("sch_1", { project_id: "proj_1" });
  });

  it("resolves an object type to its current revision through the list", async () => {
    const pages = vi.fn(() => pagesOf({ schemas: [{ id: "sch_2" }], next_page_token: null }));

    const schema = await service({
      getSchema: async () => {
        throw new NotFoundError("no such schema", { status: 404 });
      },
      listSchemas: { pages },
    }).get("human-user");

    expect(schema).toEqual({ id: "sch_2" });
    expect(pages).toHaveBeenCalledWith({
      project_id: "proj_1",
      object_type: "human-user",
      revisions: "latest",
      limit: 1,
    });
  });

  it("refuses a reference that is neither, saying how to see what the project has", async () => {
    await expect(
      service({
        getSchema: async () => {
          throw new NotFoundError("no such schema", { status: 404 });
        },
        listSchemas: { pages: () => pagesOf({ schemas: [], next_page_token: null }) },
      }).get("typo"),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      message: 'No schema named "typo"',
      hint: "Run `schemas list` to see the object types this project has.",
    });
  });

  it("raises a failure that is not a miss, rather than reading it as an object type", async () => {
    await expect(
      service({
        getSchema: async () => {
          throw new Error("boom");
        },
      }).get("sch_1"),
    ).rejects.toThrow("boom");
  });

  // A revision id that nothing holds says the reference was an object type. A
  // revision the server says is gone says nothing of the kind, and both arrive
  // as the not-found class.
  it("raises a revision the server says is gone, rather than reading it as an object type", async () => {
    await expect(
      service({
        getSchema: async () => {
          throw responseFailure(410, "http://localhost:8080/schemas/sch_1", {}, "Gone");
        },
      }).get("sch_1"),
    ).rejects.toThrow("Gone");
  });
});

describe("SchemaService.create", () => {
  it("sends the document as given for the project it is bound to", async () => {
    const publishSchema = vi.fn(async () => ({ id: "sch_1" }));
    const input = {
      objectType: "human-user",
      kind: "user-schema" as const,
      metaSchema: "https://zitadel.com/schemas/user/v1",
      "x-auth-methods": {},
    };

    await service({ publishSchema }).create(input);

    expect(publishSchema).toHaveBeenCalledWith(input, { project_id: "proj_1" });
  });
});

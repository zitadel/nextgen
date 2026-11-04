import { describe, expect, it, vi } from "vitest";

import { NotFoundError } from "../../../../../src/lib/backend/errors";
import { SchemaService } from "../../../../../src/lib/backend/services/schema";
import { type ClientStubs, fakeClient } from "../../../../helpers/fake-client";

/** A service answering `stubs`, bound to one project. */
function service(stubs: ClientStubs): SchemaService {
  return new SchemaService(fakeClient(stubs), "proj_1");
}

describe("SchemaService.list", () => {
  it("lists the schemas of the project it is bound to, narrowed by the query", async () => {
    const listSchemas = vi.fn(async () => ({ schemas: [] }));

    await service({ listSchemas }).list({ object_type: "human-user" });

    expect(listSchemas).toHaveBeenCalledWith({ project_id: "proj_1", object_type: "human-user" });
  });

  it("answers one page and the cursor to the next", async () => {
    const page = await service({
      listSchemas: async () => ({ schemas: [{ id: "sch_1" }], next_page_token: "t2" }),
    }).list();

    expect(page.items).toEqual([{ id: "sch_1" }]);
    expect(page.next).toBe("t2");
  });

  it("answers no cursor when the server sent none", async () => {
    const page = await service({ listSchemas: async () => ({ schemas: [] }) }).list();

    expect(page.next).toBeNull();
  });
});

describe("SchemaService.get", () => {
  it("fetches a revision id directly", async () => {
    const getSchemaById = vi.fn(async () => ({ id: "sch_1" }));

    await expect(service({ getSchemaById }).get("sch_1")).resolves.toEqual({ id: "sch_1" });
    expect(getSchemaById).toHaveBeenCalledWith("sch_1");
  });

  it("resolves an object type to its current revision through the list", async () => {
    const listSchemas = vi.fn(async () => ({ schemas: [{ id: "sch_2" }] }));

    const schema = await service({
      getSchemaById: async () => {
        throw new NotFoundError("no such schema", { status: 404 });
      },
      listSchemas,
    }).get("human-user");

    expect(schema).toEqual({ id: "sch_2" });
    expect(listSchemas).toHaveBeenCalledWith({
      project_id: "proj_1",
      object_type: "human-user",
      revisions: "latest",
      limit: 1,
    });
  });

  it("refuses a reference that is neither, saying how to see what the project has", async () => {
    await expect(
      service({
        getSchemaById: async () => {
          throw new NotFoundError("no such schema", { status: 404 });
        },
        listSchemas: async () => ({ schemas: [] }),
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
        getSchemaById: async () => {
          throw new Error("boom");
        },
      }).get("sch_1"),
    ).rejects.toThrow("boom");
  });
});

describe("SchemaService.create", () => {
  it("sends the document as given for the project it is bound to", async () => {
    const createSchema = vi.fn(async () => ({ id: "sch_1" }));
    const input = {
      objectType: "human-user",
      kind: "user-schema" as const,
      metaSchema: "https://zitadel.com/schemas/user/v1",
      "x-auth-methods": {},
    };

    await service({ createSchema }).create(input);

    expect(createSchema).toHaveBeenCalledWith(input, { project_id: "proj_1" });
  });
});

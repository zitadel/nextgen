import { describe, expect, it } from "vitest";
import { z } from "zod";

import { BaseCommand } from "../../../../../src/lib/oclif";
import {
  bindOperation,
  definitionOf,
  CreateOperation,
  type CreateSpec,
  DeleteOperation,
  type DeleteSpec,
  GetOperation,
  type GetSpec,
  ListOperation,
  type ListSpec,
  type OperationDefinition,
  type ResourceDescriptor,
  UpdateOperation,
  type UpdateSpec,
} from "../../../../../src/lib/oclif/crud";

type Ctx = { token: string };

const schema = z.object({ name: z.string() });
const OPERATIONS = ["equals", "contains"] as const;
const list: ListSpec<Ctx> = {
  items: "teams",
  body: schema,
  filters: [
    { field: "name", operations: OPERATIONS },
    { field: "status", operations: OPERATIONS },
  ],
  sorts: ["created_at"],
  call: async () => ({ teams: [] }),
};
const get: GetSpec<Ctx> = { call: async () => ({}) };
const create: CreateSpec<Ctx> = { schema, call: async () => ({}) };
const update: UpdateSpec<Ctx> = { schema, call: async () => ({}) };
const remove: DeleteSpec<Ctx> = { outcome: "revoked", call: async () => undefined };
const resource: ResourceDescriptor<Ctx> = {
  singular: "team",
  idField: "id",
  columns: ["id", "name"],
  list,
  get,
  create,
  update,
  delete: remove,
};
const options = {
  connect: async () => ({ token: "t" }),
  operations: ["equals", "contains"],
  flags: { extra: { type: "boolean" as const } },
};
const definition = <Spec>(spec: Spec): OperationDefinition<Ctx, Spec> => ({
  topic: "teams",
  resource,
  spec,
  options,
});

describe("operation statics", () => {
  it("list (query) exposes paging, filter, sort, and the extra flags", () => {
    const statics = ListOperation.describe(definition(list));
    expect(statics.description).toBe("List teams.");
    expect(Object.keys(statics.flags)).toEqual([
      "limit",
      "page-token",
      "all",
      "fields",
      "plain",
      "filter",
      "sort",
      "extra",
    ]);
    expect(statics.args).toEqual({});
    expect(statics.examples[2]).toBe(
      "<%= config.bin %> teams list --filter name=equals:<value> --sort created_at:desc",
    );
  });

  it("list (GET transport) shares the same filter grammar", () => {
    // No `body`, so the request goes out as query parameters — but the caller
    // sees the one `--filter` grammar, not a flag per parameter.
    const statics = ListOperation.describe(
      definition({
        items: "data",
        filters: [
          { field: "category", operations: ["equals"], values: ["a", "b"], combine: "or" as const },
          { field: "actor_id", operations: ["equals"] },
        ],
        call: async () => ({ data: [] }),
      }),
    );
    expect(Object.keys(statics.flags)).toEqual([
      "limit",
      "page-token",
      "all",
      "fields",
      "plain",
      "filter",
      "extra",
    ]);
    const filter = statics.flags.filter as { description?: string };
    expect(filter.description).toContain("category (equals; values a|b; repeats widen)");
    expect(statics.examples[2]).toBe(
      "<%= config.bin %> teams list --filter category=equals:<value>",
    );
  });

  it("omits the paging flags for an unpaginated list", () => {
    const statics = ListOperation.describe(
      definition({ items: "data", paged: false, call: async () => ({ data: [] }) }),
    );
    expect(Object.keys(statics.flags)).toEqual(["fields", "plain", "extra"]);
  });

  it("get, update, and delete take an id argument; create does not", () => {
    expect(Object.keys(GetOperation.describe(definition(get)).args)).toEqual(["id"]);
    expect(Object.keys(UpdateOperation.describe(definition(update)).args)).toEqual(["id"]);
    expect(Object.keys(DeleteOperation.describe(definition(remove)).args)).toEqual(["id"]);
    expect(CreateOperation.describe(definition(create)).args).toEqual({});
  });

  it("create and update expose the schema's fields alongside the raw-body flags", () => {
    for (const statics of [
      CreateOperation.describe(definition(create)),
      UpdateOperation.describe(definition(update)),
    ]) {
      expect(Object.keys(statics.flags)).toEqual(["name", "data", "file", "extra"]);
      const flags = statics.flags as Record<string, { helpGroup?: string }>;
      expect(flags.name?.helpGroup).toBe("REQUIRED FIELD");
      expect(flags.data?.helpGroup).toBe("RAW BODY");
    }
  });

  it("leads the create examples with the required fields", () => {
    expect(CreateOperation.describe(definition(create)).examples[0]).toBe(
      "<%= config.bin %> teams create --name <name> --json",
    );
  });

  it("offers no flags-only example when the body needs a nested object", () => {
    // Flags cannot carry a nested object, so an example made of them would be
    // an incomplete body the platform rejects. `--data` / `--file` remain.
    const nested: CreateSpec<Ctx> = {
      schema: z.object({ name: z.string(), owner: z.object({ id: z.string() }).optional() }),
      call: async () => ({}),
    };

    const examples = CreateOperation.describe(definition(nested)).examples;

    expect(examples[0]).toBe("<%= config.bin %> teams create --data '{...}' --json");
    expect(examples.join(" ")).not.toContain("--name <name>");
  });

  it("delete is spelled the same way whatever the server does to the resource", () => {
    // An endpoint that revokes rather than removes does not get its own verb:
    // the command is `delete` everywhere, and the outcome is in the result.
    const statics = DeleteOperation.describe(definition(remove));
    expect(statics.description).toBe("Delete a team by id.");
    expect(statics.examples).toEqual(["<%= config.bin %> teams delete <id> --force --json"]);
  });
});

describe("bindOperation", () => {
  it("produces a BaseCommand subclass carrying the definition and statics", () => {
    const Bound = bindOperation(GetOperation, definition(get));
    expect(Object.getPrototypeOf(Bound)).toBe(GetOperation);
    expect(Bound.prototype).toBeInstanceOf(BaseCommand);
    expect(Bound.description).toBe("Get one team by id.");
    expect(Object.keys(Bound.flags)).toEqual(["fields", "extra"]);
    expect(Object.keys(Bound.args)).toEqual(["id"]);
    expect(definitionOf(Bound)).toEqual(definition(get));
    // The definition is held beside the class, not on it: oclif copies a
    // command's own statics into `commands --json` and the manifest.
    expect(Object.hasOwn(Bound, "definition")).toBe(false);
  });

  it("keeps each bound class independent", () => {
    const a = bindOperation(GetOperation, definition(get));
    const b = bindOperation(GetOperation, { ...definition(get), topic: "users" });
    expect(a).not.toBe(b);
    expect(a.examples).not.toEqual(b.examples);
  });
});

describe("wire conventions", () => {
  it("sends and reads the vocabulary the caller declared, not this API's", async () => {
    // The factory must not carry one platform's cursor names as though they
    // were universal: a list is driven here with `cursor`/`next_cursor` and a
    // query body that nests its filters, and nothing in the factory objects.
    let sent: unknown;
    const spec: ListSpec<Ctx> = {
      items: "rows",
      body: z.object({}).passthrough(),
      filters: [{ field: "state", operations: ["equals"] }],
      call: async (_ctx, request) => {
        sent = request;
        return { rows: [{ id: "r1" }], next_cursor: "c2" };
      },
    };
    const definition: OperationDefinition<Ctx, ListSpec<Ctx>> = {
      topic: "rows",
      resource: { singular: "row", idField: "id", columns: ["id"], list: spec },
      spec,
      options: {
        connect: async () => ({ token: "t" }),
        operations: ["equals"],
        wire: {
          limit: "size",
          pageToken: "cursor",
          nextPageToken: "next_cursor",
          query: ({ paging, filters }) => ({ ...paging, where: filters }),
        },
      },
    };

    const command = bindOperation(ListOperation, definition);
    const result = await command.run(["--filter", "state=active", "--limit", "5", "--json"]);

    expect(sent).toEqual({ size: 5, where: [{ field: "state", operation: "equals", value: "active" }] });
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.next_cursor).toBe("c2");
    expect(data.next_page_token).toBeUndefined();
  });
});

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
const list: ListSpec<Ctx> = {
  kind: "query",
  items: "teams",
  body: schema,
  filterFields: ["name", "status"],
  sortFields: ["created_at"],
  call: async () => ({ teams: [] }),
};
const get: GetSpec<Ctx> = { call: async () => ({}) };
const create: CreateSpec<Ctx> = { schema, call: async () => ({}) };
const update: UpdateSpec<Ctx> = { schema, call: async () => ({}) };
const remove: DeleteSpec<Ctx> = { verb: "revoke", call: async () => undefined };
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

  it("list (params) exposes one flag per parameter", () => {
    const statics = ListOperation.describe(
      definition({
        kind: "params" as const,
        items: "data",
        params: [
          {
            flag: "category",
            param: "category",
            description: "c",
            multiple: true,
            options: ["a", "b"],
          },
          { flag: "actor-id", param: "actor_id", description: "a" },
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
      "category",
      "actor-id",
      "extra",
    ]);
    expect(statics.examples[2]).toBe("<%= config.bin %> teams list --category a --limit 50");
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

  it("delete uses the registry's verb in its description and example", () => {
    const statics = DeleteOperation.describe(definition(remove));
    expect(statics.description).toBe("Revoke a team by id.");
    expect(statics.examples).toEqual(["<%= config.bin %> teams revoke <id> --force --json"]);
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

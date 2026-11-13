import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Command } from "@oclif/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { answering, atTerminal } from "@tests/helpers/keyboard";
import { DrawnSpinner } from "@/lib/ui/spinner";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { printing } from "@tests/helpers/run-cli";
import { asTerminal, offTerminal } from "@tests/helpers/terminal";
import { EXIT_CODES } from "@/lib/errors";
import { BaseCommand } from "@/lib/oclif";
import {
  bindOperation as bindOperationOnly,
  definitionOf,
  CreateOperation,
  type CreateSpec,
  DeleteOperation,
  type DeleteSpec,
  GetOperation,
  type GetSpec,
  type Json,
  ListOperation,
  type ListSpec,
  type OperationClass,
  type OperationDefinition,
  type ResourceDescriptor,
  UpdateOperation,
  type UpdateSpec,
} from "@/lib/oclif/crud";

/**
 * The generated command each operation stands in for. A run suggests commands
 * by id and renders them from what the loaded CLI declares for that id, so a
 * bound operation takes the id of a real command with the same verb.
 */
const STAND_IN = new Map<unknown, string>([
  [ListOperation, "team:list"],
  [GetOperation, "team:get"],
  [CreateOperation, "team:create"],
  [UpdateOperation, "team:update"],
]);

/**
 * Runs `command` against the CLI's own package, whose config knows the commands
 * a run suggests: a command run on its own would load the config of whatever
 * started the test runner.
 */
function inCli<Bound extends typeof Command>(command: Bound, id: string): Bound {
  return Object.assign(command, {
    id,
    run: (argv: string[]) => {
      return Reflect.apply(Command.run, command, [argv, cliPackageRoot]);
    },
  });
}

/** {@link bindOperationOnly}, named as the command it stands in for. */
const bindOperation: typeof bindOperationOnly = (operation, definition) => {
  return inCli(
    bindOperationOnly(operation, definition),
    STAND_IN.get(operation) ?? "team:deactivate",
  );
};

/** How long clack waits between one frame of a spinner and the next. */
const FRAME = 100;

type Ctx = { token: string };

const schema = z.object({ name: z.string() });
const OPERATIONS = ["equals", "contains"] as const;
const list: ListSpec<Ctx, Json, { teams: readonly unknown[]; next_page_token?: string }> = {
  body: schema,
  filters: [
    { field: "name", operations: OPERATIONS },
    { field: "status", operations: OPERATIONS },
  ],
  sorts: ["created_at"],
  call: async () => ({ teams: [] }),
  items: (page) => page.teams,
  next: (page) => page.next_page_token,
};
const get: GetSpec<Ctx> = { call: async () => ({}) };
const create: CreateSpec<Ctx> = { schema, call: async () => ({}) };
const update: UpdateSpec<Ctx> = { schema, call: async () => ({}) };
const remove: DeleteSpec<Ctx> = { outcome: "revoked", call: async () => undefined };
const resource: ResourceDescriptor<Ctx> = {
  singular: "team",
  idField: "id",
  idOf: (written) => written.id,
  columns: ["id", "name"],
  list,
  get,
  create,
  update,
  delete: remove,
};
const options = {
  connect: async () => ({ token: "t" }),
  operations: ["equals"],
  flags: { extra: { type: "boolean" as const } },
} as unknown as OperationDefinition<Ctx, GetSpec<Ctx>>["options"];
const definition = <Spec>(spec: Spec): OperationDefinition<Ctx, Spec> => ({
  topic: "team",
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
      "filter",
      "sort",
      "extra",
      "plain",
    ]);
    expect(statics.args).toEqual({});
    expect(statics.examples[2]).toBe(
      "<%= config.bin %> team list --filter name=equals:<value> --sort created_at:desc",
    );
  });

  it("list (GET transport) shares the same filter grammar", () => {
    // No `body`, so the request goes out as query parameters — but the caller
    // sees the one `--filter` grammar, not a flag per parameter.
    const statics = ListOperation.describe(
      definition({
        filters: [
          { field: "category", operations: ["equals"], values: ["a", "b"], combine: "or" as const },
          { field: "actor_id", operations: ["equals"] },
        ],
        call: async () => ({ data: [] }),
        items: (page: { data: readonly unknown[] }) => page.data,
        next: () => undefined,
      }),
    );
    expect(Object.keys(statics.flags)).toEqual([
      "limit",
      "page-token",
      "all",
      "fields",
      "filter",
      "extra",
      "plain",
    ]);
    const filter = statics.flags.filter as { description?: string };
    expect(filter.description).toContain("category (equals; values a|b; repeats widen)");
    expect(statics.examples[2]).toBe(
      "<%= config.bin %> team list --filter category=equals:<value>",
    );
  });

  it("omits the paging flags for an unpaginated list", () => {
    const statics = ListOperation.describe(
      definition({
        paged: false as const,
        call: async () => ({ data: [] }),
        items: (page: { data: readonly unknown[] }) => page.data,
      }),
    );
    expect(Object.keys(statics.flags)).toEqual(["fields", "extra", "plain"]);
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
      expect(Object.keys(statics.flags)).toEqual(["name", "data", "file", "set", "extra"]);
      const flags = statics.flags as Record<string, { helpGroup?: string }>;
      expect(flags.name?.helpGroup).toBe("REQUIRED FIELD");
      expect(flags.data?.helpGroup).toBe("RAW BODY");
    }
  });

  it("describes one body schema once per part of it that is read", () => {
    const nested = z.object({ team: schema });
    const whole = CreateOperation.describe(definition({ schema: nested, call: create.call }));
    const part = CreateOperation.describe(
      definition({ schema: nested, root: "team", call: create.call }),
    );

    expect(Object.keys(whole.flags)).toContain("team-name");
    expect(Object.keys(part.flags)).toContain("name");
  });

  it("leads the create and update examples with the required fields", () => {
    expect(CreateOperation.describe(definition(create)).examples[0]).toBe(
      "<%= config.bin %> team create --name <name> --json",
    );
    expect(UpdateOperation.describe(definition(update)).examples[0]).toBe(
      "<%= config.bin %> team update <id> --name <name> --json",
    );
  });

  it("names the --file example as one shell word for a multi-word resource", () => {
    const idps = <Spec>(spec: Spec): OperationDefinition<Ctx, Spec> => ({
      ...definition(spec),
      topic: "idp",
      resource: { ...resource, singular: "identity provider connection" },
    });

    expect(CreateOperation.describe(idps(create)).examples).toContain(
      "<%= config.bin %> idp create --file ./identity-provider-connection.json",
    );
    expect(UpdateOperation.describe(idps(update)).examples).toContain(
      "<%= config.bin %> idp update <id> --file ./identity-provider-connection.json",
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

    expect(examples[0]).toBe("<%= config.bin %> team create --data '{...}' --json");
    expect(examples.join(" ")).not.toContain("--name <name>");
  });

  it("leads with the example a registry entry declares", () => {
    const declared: CreateSpec<Ctx> = {
      schema,
      example: "--name platform",
      call: async () => ({}),
    };

    expect(CreateOperation.describe(definition(declared)).examples[0]).toBe(
      "<%= config.bin %> team create --name platform --json",
    );
  });

  it("names a rooted document's own fields as flags", () => {
    const rooted: CreateSpec<Ctx> = {
      root: "team",
      schema: z.object({ team: z.object({ name: z.string() }) }),
      call: async () => ({}),
    };

    expect(Object.keys(CreateOperation.describe(definition(rooted)).flags)).toEqual([
      "name",
      "data",
      "file",
      "set",
      "extra",
    ]);
  });

  it("delete is spelled the same way whatever the server does to the resource", () => {
    // An endpoint that revokes rather than removes does not get its own verb:
    // the command is `delete` everywhere, and the outcome is in the result.
    const statics = DeleteOperation.describe(definition(remove));
    expect(statics.description).toBe("Delete a team by id.");
    expect(statics.examples).toEqual(["<%= config.bin %> team delete <id> --force --json"]);
  });
});

describe("bindOperation", () => {
  it("produces a BaseCommand subclass carrying the definition and statics", () => {
    const Bound = bindOperation(GetOperation as OperationClass<Ctx, GetSpec<Ctx>>, definition(get));
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
    const a = bindOperation(GetOperation as OperationClass<Ctx, GetSpec<Ctx>>, definition(get));
    const b = bindOperation(GetOperation as OperationClass<Ctx, GetSpec<Ctx>>, {
      ...definition(get),
      topic: "user",
    });
    expect(a).not.toBe(b);
    expect(a.examples).not.toEqual(b.examples);
  });
});

describe("wire conventions", () => {
  it("sends and reads the vocabulary the caller declared, not this API's", async () => {
    // The factory must not carry one platform's cursor names as though they
    // were universal: a list is driven here with `cursor`/`next_cursor` and a
    // query body that nests its filters, and nothing in the factory objects.
    // The page holds its cursor as `continuation`, which only the spec's own
    // `next` reads; the envelope reports it under the wire's name.
    const sent: unknown[] = [];
    const spec: ListSpec<Ctx, Json, { rows: readonly unknown[]; continuation?: string }> = {
      body: z.object({}).passthrough(),
      filters: [{ field: "state", operations: ["equals"] }],
      call: async (_ctx, request) => {
        sent.push(request);
        return { rows: [{ id: "r1" }], continuation: "c2" };
      },
      items: (page) => page.rows,
      next: (page) => page.continuation,
    };
    const definition: OperationDefinition<Ctx, ListSpec<Ctx>> = {
      topic: "rows",
      resource: {
        singular: "row",
        idField: "id",
        idOf: (written) => written.id,
        columns: ["id"],
        list: spec,
      },
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

    const command = bindOperation(ListOperation as OperationClass<Ctx, ListSpec<Ctx>>, definition);
    // `bindOperation` is typed as the abstract `typeof Command`, whose static
    // `run` has a constructable-`this` constraint the abstract type does not
    // satisfy; the bound class is concrete at runtime.
    const result = await (command as unknown as { run(argv: string[]): Promise<unknown> }).run([
      "--filter",
      "state=active",
      "--limit",
      "5",
      "--json",
    ]);

    expect(sent[0]).toEqual({
      size: 5,
      where: [{ field: "state", operation: "equals", value: "active" }],
    });
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.next_cursor).toBe("c2");
    expect(data.next_page_token).toBeUndefined();
  });
});

describe("list filters", () => {
  it("refuses an operation the platform knows that the field does not offer", async () => {
    const spec: ListSpec<Ctx, Json, { rows: readonly unknown[] }> = {
      body: z.object({}).passthrough(),
      filters: [{ field: "state", operations: ["equals"] }],
      call: async () => ({ rows: [] }),
      items: (page) => page.rows,
      next: () => undefined,
    };
    const definition: OperationDefinition<Ctx, ListSpec<Ctx>> = {
      topic: "rows",
      resource: {
        singular: "row",
        idField: "id",
        idOf: (written) => written.id,
        columns: ["id"],
        list: spec,
      },
      spec,
      options: { connect: async () => ({ token: "t" }), operations: ["equals", "less_than"] },
    };

    const command = bindOperation(ListOperation as OperationClass<Ctx, ListSpec<Ctx>>, definition);

    await expect(printed(command, ["--filter", "state=less_than:5"])).rejects.toThrow(
      /Filter field "state" does not support the less_than\s+operation/,
    );
  });
});

describe("list nouns", () => {
  const nothingListed = async (plural: string | undefined): Promise<string> => {
    const spec: ListSpec<Ctx, Json, { rows: readonly unknown[] }> = {
      body: z.object({}).passthrough(),
      filters: [],
      call: async () => ({ rows: [] }),
      items: (page) => page.rows,
      next: () => undefined,
    };
    const named: OperationDefinition<Ctx, ListSpec<Ctx>> = {
      topic: "idp",
      resource: {
        singular: "identity provider",
        ...(plural === undefined ? {} : { plural }),
        idField: "id",
        idOf: (written) => written.id,
        columns: ["id"],
        list: spec,
      },
      spec,
      options: { connect: async () => ({ token: "t" }), operations: ["equals"] },
    };
    const command = bindOperation(ListOperation as OperationClass<Ctx, ListSpec<Ctx>>, named);
    const { stdout } = await printing(() =>
      asTerminal(() => (command as unknown as { run(argv: string[]): Promise<unknown> }).run([])),
    );
    return stdout;
  };

  it("says the descriptor's plural when nothing is found", async () => {
    expect(await nothingListed("identity providers")).toContain("No identity providers found");
  });

  it("adds an s to the singular when the descriptor names no plural", async () => {
    expect(await nothingListed(undefined)).toContain("No identity providers found");
  });
});

describe("write results", () => {
  it("carries data and no next command when the server answers without a body", async () => {
    // `grant create` by identifier answers 202 with no body.
    const accepted: CreateSpec<Ctx> = { schema, call: async () => undefined };
    const command = bindOperation(
      CreateOperation as OperationClass<Ctx, CreateSpec<Ctx>>,
      definition(accepted),
    );

    const envelope = await (command as unknown as { run(argv: string[]): Promise<unknown> }).run([
      "--name",
      "a",
      "--json",
    ]);

    // Round-tripped as printed: JSON drops a key whose value is undefined.
    expect(JSON.parse(JSON.stringify(envelope))).toHaveProperty("data", {
      title: "Command completed",
    });
  });

  it("draws what it wrote as one line when the id has a line break in it", async () => {
    const odd: CreateSpec<Ctx> = { schema, call: async () => ({ id: "a\nb", name: "a" }) };
    const command = bindOperation(
      CreateOperation as OperationClass<Ctx, CreateSpec<Ctx>>,
      definition(odd),
    );

    const { stdout } = await printing(() =>
      asTerminal(() =>
        (command as unknown as { run(a: string[]): Promise<unknown> }).run(["--name", "a"]),
      ),
    );

    expect(stdout).toContain("Created team a\\x0ab");
  });

  it("says the command completed when the server answers without a body, not that it wrote {}", async () => {
    // `grant create` by identifier answers 202 with no body, so there is no
    // record to print and the generic rendering is the honest one.
    const accepted: CreateSpec<Ctx> = { schema, call: async () => undefined };
    const command = bindOperation(
      CreateOperation as OperationClass<Ctx, CreateSpec<Ctx>>,
      definition(accepted),
    );

    const { stdout } = await printed(command, ["--name", "a"]);

    expect(stdout.join("\n")).not.toBe("{}");
    expect(stdout.join("\n")).toContain("Command completed");
  });

  it.each([
    ["create", CreateOperation, []],
    ["update", UpdateOperation, ["team_1"]],
  ] as const)(
    "draws the %s summary on a terminal and the record when piped",
    async (verb, Operation, ids) => {
      const written: CreateSpec<Ctx> & UpdateSpec<Ctx> = {
        schema,
        call: async () => ({ id: "team_1", name: "a" }),
      };
      const command = bindOperation(
        Operation as OperationClass<Ctx, CreateSpec<Ctx>>,
        definition(written),
      );
      const argv = [...ids, "--name", "a"];

      const onScreen = await printing(() =>
        asTerminal(() => (command as unknown as { run(a: string[]): Promise<unknown> }).run(argv)),
      );
      const piped = await printing(() =>
        offTerminal(() => (command as unknown as { run(a: string[]): Promise<unknown> }).run(argv)),
      );

      expect(onScreen.stdout).toContain(`${verb === "create" ? "Created" : "Updated"} team team_1`);
      expect(piped.stdout).toContain('"id": "team_1"');
    },
  );

  it("asks the server on a dry run of an update that can check, and never writes", async () => {
    const call = vi.fn(async () => ({ id: "team_1" }));
    const check = vi.fn(async () => ({ id: "team_1", name: "a" }));
    const checked: UpdateSpec<Ctx> = { schema, call, check };
    const command = bindOperation(
      UpdateOperation as OperationClass<Ctx, UpdateSpec<Ctx>>,
      definition(checked),
    );

    const envelope = await (command as unknown as { run(argv: string[]): Promise<unknown> }).run([
      "team_1",
      "--name",
      "a",
      "--dry-run",
      "--json",
    ]);

    expect(check).toHaveBeenCalledWith({ token: "t" }, "team_1", { name: "a" });
    expect(call).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(envelope))).toMatchObject({
      data: {
        dry_run: true,
        id: "team_1",
        body: { name: "a" },
        result: { id: "team_1", name: "a" },
      },
    });
  });

  it("offers the same write without --dry-run as the next command, keeping what was typed", async () => {
    const command = bindOperation(
      UpdateOperation as OperationClass<Ctx, UpdateSpec<Ctx>>,
      definition({ schema, call: async () => ({ id: "team_1" }) }),
    );

    const envelope = await (command as unknown as { run(argv: string[]): Promise<unknown> }).run([
      "team_1",
      "--name",
      "a",
      "--dry-run",
      "--json",
    ]);

    expect(JSON.parse(JSON.stringify(envelope))).toMatchObject({
      data: { next_commands: [expect.stringMatching(/ team update team_1 --name a$/)] },
    });
  });

  it("names the resource a dry run would write as the prompt does, not the topic", async () => {
    const command = bindOperation(CreateOperation as OperationClass<Ctx, CreateSpec<Ctx>>, {
      ...definition(create),
      topic: "idp",
      resource: { ...resource, singular: "identity provider" },
    });

    const { stdout } = await printed(command, ["--name", "a", "--dry-run"]);

    expect(stdout.join("\n")).toContain("Would create identity provider (dry run)");
  });

  it("lets a server's refusal of a dry run fail the command", async () => {
    const call = vi.fn(async () => ({}));
    const checked: UpdateSpec<Ctx> = {
      schema,
      call,
      check: () => Promise.reject(new Error("refused")),
    };
    const command = bindOperation(
      UpdateOperation as OperationClass<Ctx, UpdateSpec<Ctx>>,
      definition(checked),
    );

    await expect(
      (command as unknown as { run(argv: string[]): Promise<unknown> }).run([
        "team_1",
        "--name",
        "a",
        "--dry-run",
        "--json",
      ]),
    ).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });

  it("connects to nothing on a dry run of an update that cannot check", async () => {
    const connect = vi.fn(async () => ({ token: "t" }));
    const command = bindOperation(UpdateOperation as OperationClass<Ctx, UpdateSpec<Ctx>>, {
      ...definition(update),
      options: { ...options, connect } as typeof options,
    });

    const envelope = await (command as unknown as { run(argv: string[]): Promise<unknown> }).run([
      "team_1",
      "--name",
      "a",
      "--dry-run",
      "--json",
    ]);

    expect(connect).not.toHaveBeenCalled();
    expect(JSON.parse(JSON.stringify(envelope)).data).not.toHaveProperty("result");
  });

  it("suggests getting the resource an update answered with", async () => {
    const updated: UpdateSpec<Ctx> = { schema, call: async () => ({ id: "team_1", name: "a" }) };
    const command = bindOperation(
      UpdateOperation as OperationClass<Ctx, UpdateSpec<Ctx>>,
      definition(updated),
    );

    const runnable = command as unknown as {
      run(argv: string[]): Promise<{ data: { next_commands: string[] } }>;
    };
    const envelope = await runnable.run(["team_1", "--name", "a", "--json"]);

    expect(envelope.data.next_commands[0]).toContain("team get team_1 --json");
  });
});

/** What a bound command prints, per stream, when run with these arguments. */
async function printed(
  command: unknown,
  argv: string[],
): Promise<{ stdout: string[]; stderr: string[] }> {
  const prototype = (command as { prototype: BaseCommand }).prototype;
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(prototype, "log").mockImplementation((message?: string) => {
    stdout.push(message ?? "");
  });
  vi.spyOn(prototype, "logToStderr").mockImplementation((message?: string) => {
    stderr.push(message ?? "");
  });
  try {
    await (command as { run(argv: string[]): Promise<unknown> }).run(argv);
  } catch (error) {
    throw new Error(`${String(error)}\n${stderr.join("\n")}`);
  }
  return { stdout, stderr };
}

describe("output a script reads", () => {
  const paged: ListSpec<Ctx> = {
    ...list,
    body: z.object({}).passthrough(),
    call: async () => ({ teams: [{ id: "team_1", name: "a" }], next_page_token: "p2" }),
  };
  const created: CreateSpec<Ctx> = { schema, call: async () => ({ id: "team_1", name: "a" }) };

  it("leaves a plain page's rows as the only thing on stdout", async () => {
    const command = bindOperation(
      ListOperation as OperationClass<Ctx, ListSpec<Ctx>>,
      definition(paged),
    );

    const { stdout } = await printed(command, ["--plain"]);

    expect(stdout).toEqual(["team_1\ta"]);
  });

  it("prints a plain page's next page on stderr", async () => {
    const command = bindOperation(
      ListOperation as OperationClass<Ctx, ListSpec<Ctx>>,
      definition(paged),
    );

    const { stderr } = await printed(command, ["--plain"]);

    expect(stderr.join("\n")).toContain("team list --plain --page-token p2");
  });

  it("carries --fields into the next page it suggests", async () => {
    const command = bindOperation(
      ListOperation as OperationClass<Ctx, ListSpec<Ctx>>,
      definition(paged),
    );

    const { stderr } = await printed(command, ["--plain", "--fields", "name"]);

    expect(stderr.join("\n")).toContain("team list --plain --fields name --page-token p2");
  });

  it("leaves a created resource's JSON body as the only thing on stdout", async () => {
    const command = bindOperation(
      CreateOperation as OperationClass<Ctx, CreateSpec<Ctx>>,
      definition(created),
    );

    const { stdout } = await printed(command, ["--name", "a"]);

    expect(stdout).toEqual([JSON.stringify({ id: "team_1", name: "a" }, null, 2)]);
  });
});

describe("list paging", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for the page --page-token names first", async () => {
    const sent: unknown[] = [];
    const command = bindOperation(
      ListOperation as OperationClass<Ctx, ListSpec<Ctx>>,
      definition({
        ...list,
        body: z.object({}).passthrough(),
        call: async (_ctx, body) => {
          sent.push(body);
          return { teams: [] };
        },
      }),
    );

    await printed(command, ["--page-token", "p2", "--plain"]);

    expect(sent).toEqual([expect.objectContaining({ page_token: "p2" })]);
  });

  it("reports each page of a drain once it has it", async () => {
    vi.useFakeTimers();
    const screen = atTerminal();
    const seen: string[] = [];
    const command = bindOperation(
      ListOperation as OperationClass<Ctx, ListSpec<Ctx>>,
      definition({
        ...list,
        body: z.object({}).passthrough(),
        call: async (_ctx, body) => {
          vi.advanceTimersByTime(FRAME);
          const token = (body as { page_token?: string }).page_token;
          seen.push(`${token ?? "first"} asked after ${screen.plain().includes("page 1")}`);
          if (token === undefined) {
            return { teams: [], next_page_token: "p2" };
          }
          return token === "p2" ? { teams: [], next_page_token: "p3" } : { teams: [] };
        },
      }),
    );

    await asTerminal(() => printed(command, ["--all", "--plain"]));

    expect(seen).toEqual(["first asked after false", "p2 asked after true", "p3 asked after true"]);
    expect(screen.plain()).toContain("Fetching teams — page 2");
  });

  it("names the descriptor's plural in the drain's spinner, not the topic", async () => {
    vi.useFakeTimers();
    const screen = atTerminal();
    const command = bindOperation(ListOperation as OperationClass<Ctx, ListSpec<Ctx>>, {
      ...definition({
        ...list,
        body: z.object({}).passthrough(),
        call: async (_ctx, body) => {
          vi.advanceTimersByTime(FRAME);
          const token = (body as { page_token?: string }).page_token;
          return token === undefined ? { teams: [], next_page_token: "p2" } : { teams: [] };
        },
      }),
      topic: "idp",
      resource: { ...resource, singular: "identity provider", plural: "identity providers" },
    });

    await asTerminal(() => printed(command, ["--all", "--plain"]));

    expect(screen.plain()).toContain("Fetching identity providers — page 1");
  });

  it.each([
    [1, "Fetched 1 team"],
    [2, "Fetched 2 teams"],
  ])("stops the drain's spinner on how many it found: %i", async (found, text) => {
    const person = answering();
    const command = bindOperation(
      ListOperation as OperationClass<Ctx, ListSpec<Ctx>>,
      definition({
        ...list,
        body: z.object({}).passthrough(),
        call: async () => {
          return { teams: Array.from({ length: found }, (_, index) => ({ id: `t_${index}` })) };
        },
      }),
    );

    await asTerminal(() => printed(command, ["--all", "--plain"]));

    expect(person.plain()).toContain(text);
  });

  it("clears the drain's spinner when a page throws", async () => {
    const person = answering();
    const command = bindOperation(
      ListOperation as OperationClass<Ctx, ListSpec<Ctx>>,
      definition({
        ...list,
        body: z.object({}).passthrough(),
        call: async () => {
          throw new Error("the page failed");
        },
      }),
    );

    await asTerminal(() => printed(command, ["--all", "--plain"])).catch(() => undefined);

    expect(DrawnSpinner.active.size).toBe(0);
    expect(person.plain()).not.toContain("Fetched");
  });
});

describe("assembling a body", () => {
  const connection = z.object({
    slug: z.string(),
    oidc: z
      .object({ issuer: z.string(), pkce: z.boolean().default(true), scopes: z.array(z.string()) })
      .optional(),
  });
  const sent: unknown[] = [];
  const rooted: CreateSpec<Ctx> = {
    root: "connection",
    schema: z.object({ connection }),
    call: async (_ctx, body) => {
      sent.push(body);
      return { id: "c_1" };
    },
  };
  const creating = () =>
    bindOperation(
      CreateOperation as OperationClass<Ctx, CreateSpec<Ctx>>,
      definition(rooted),
    ) as unknown as { run(argv: string[]): Promise<unknown> };

  afterEach(() => {
    sent.length = 0;
  });

  it("wraps a rooted document in its root on the way out", async () => {
    await creating().run([
      "--slug",
      "acme",
      "--oidc-issuer",
      "https://x",
      "--oidc-scopes",
      "openid",
      "--json",
    ]);

    expect(sent).toEqual([
      {
        connection: { slug: "acme", oidc: { issuer: "https://x", pkce: true, scopes: ["openid"] } },
      },
    ]);
  });

  it("takes a document still wrapped in its root", async () => {
    await creating().run(["--data", '{"connection":{"slug":"acme"}}', "--json"]);

    expect(sent).toEqual([{ connection: { slug: "acme" } }]);
  });

  it("lets --set path:=null replace an object a file gave, and the schema decide on it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-crud-"));
    const file = join(dir, "connection.json");
    await writeFile(
      file,
      JSON.stringify({ slug: "acme", oidc: { issuer: "https://x", scopes: ["openid"] } }),
    );
    try {
      await creating().run(["--file", file, "--json"]);
      expect(sent).toHaveLength(1);
      // `oidc` may be left out but not be null, so the same file with
      // `oidc:=null` over it fails validation, and nothing more is sent.
      await expect(
        creating().run(["--file", file, "--set", "oidc:=null", "--json"]),
      ).rejects.toThrowError(expect.objectContaining({ oclif: { exit: EXIT_CODES.E_VALIDATION } }));
      expect(sent).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("lays each source over the last: the document, the field flags, then --set in order", async () => {
    await creating().run([
      "--data",
      '{"slug":"from-data","oidc":{"issuer":"https://data","scopes":["openid"]}}',
      "--oidc-issuer",
      "https://flag",
      "--set",
      "slug=first",
      "--set",
      "slug=second",
      "--set",
      "oidc.pkce=false",
      "--json",
    ]);

    expect(sent).toEqual([
      {
        connection: {
          slug: "second",
          oidc: { issuer: "https://flag", pkce: false, scopes: ["openid"] },
        },
      },
    ]);
  });
});

describe("get sections", () => {
  const getting = bindOperation(GetOperation as OperationClass<Ctx, GetSpec<Ctx>>, {
    ...definition<GetSpec<Ctx>>({
      call: async () => ({ id: "team_1", name: "core" }),
      sections: () => ["members\n  ada"],
    }),
  }) as unknown as { run(argv: string[]): Promise<unknown> };

  /** What a run prints on a terminal. */
  const printed = async (argv: string[]): Promise<string> => {
    const { stdout } = await printing(() => asTerminal(() => getting.run(argv)));
    return stdout;
  };

  it("shows a spec's sections under the fields", async () => {
    expect(await printed(["team_1"])).toContain("name  core\n\nmembers\n  ada");
  });

  it("leaves them out when --fields picks the view", async () => {
    expect(await printed(["team_1", "--fields", "name"])).not.toContain("members");
  });

  it("draws a heading with a line break in it as one line", async () => {
    const odd = bindOperation(GetOperation as OperationClass<Ctx, GetSpec<Ctx>>, {
      ...definition<GetSpec<Ctx>>({ call: async () => ({ id: "a\nb", name: "core" }) }),
    }) as unknown as { run(argv: string[]): Promise<unknown> };

    const { stdout } = await printing(() => asTerminal(() => odd.run(["x"])));

    expect(stdout).toContain("Read a\\x0ab");
  });
});

describe("delete confirmation", () => {
  const DELETING = {
    delete: "user:delete",
    revoke: "session:revoke",
    deactivate: "team:deactivate",
  } as const;
  const deleting = (verb: "delete" | "revoke" | "deactivate", call = async () => undefined) =>
    Object.assign(
      inCli(
        bindOperationOnly(
          DeleteOperation as OperationClass<Ctx, DeleteSpec<Ctx>>,
          definition<DeleteSpec<Ctx>>({ verb, call }),
        ),
        DELETING[verb],
      ),
      // Drawn, so a question is clack's prompt, which is the one these tests answer.
      { wizard: true },
    ) as unknown as { run(argv: string[]): Promise<unknown> };

  /** What a failing command prints, which is how an agent or a person reads the failure. */
  const printedByFailing = async (
    run: () => Promise<unknown>,
  ): Promise<{ stdout: string; stderr: string }> => {
    const { stdout, stderr } = await printing(() => run().catch(() => undefined));
    return { stdout, stderr };
  };

  beforeEach(() => {
    vi.stubEnv("ZITADEL_URL", "https://api.zitadel.example");
    vi.stubEnv("ZITADEL_PROJECT_ID", "proj_env");
    vi.stubEnv("ZITADEL_PROJECT_SECRET", "sk_proj_env");
  });

  it.each(["delete", "revoke", "deactivate"] as const)(
    "names the %s, the resource and the id when it refuses without --force",
    async (verb) => {
      const failure = JSON.parse(
        (await printedByFailing(() => deleting(verb).run(["team_1", "--json"]))).stdout,
      );

      expect(failure).toMatchObject({
        code: "E_CONFIRMATION_REQUIRED",
        message: `Cannot ${verb} team team_1 without --force in non-interactive mode`,
        next_commands: [
          expect.stringContaining(`${DELETING[verb].replace(":", " ")} team_1 --force`),
        ],
      });
    },
  );

  it.each(["delete", "revoke", "deactivate"] as const)(
    "sends no %s when it refuses without --force",
    async (verb) => {
      const call = vi.fn(async () => undefined);

      await printedByFailing(() => deleting(verb, call).run(["team_1", "--json"]));

      expect(call).not.toHaveBeenCalled();
    },
  );

  it.each(["delete", "revoke", "deactivate"] as const)(
    "sends no %s when the answer is no",
    async (verb) => {
      answering(false);
      const call = vi.fn(async () => undefined);

      await asTerminal(() => deleting(verb, call).run(["team_1"]));

      expect(call).not.toHaveBeenCalled();
    },
  );

  it("keeps the id exact in the question a --json refusal carries", async () => {
    const failure = JSON.parse(
      (await printedByFailing(() => deleting("delete").run(["team\u001bx", "--json"]))).stdout,
    );

    expect(failure.details.question).toBe(
      "Delete team team\u001bx in project proj_env on api.zitadel.example?",
    );
  });

  it("asks the question with the verb, the resource, the id and the place", async () => {
    const talk = answering(true);

    await asTerminal(() => deleting("revoke").run(["team_1"]));

    expect(talk.asked()).toEqual([
      "Revoke team team_1 in project proj_env on api.zitadel.example?",
    ]);
  });

  it("names a local server by its host and port", async () => {
    vi.stubEnv("ZITADEL_URL", "http://localhost:8112");
    const talk = answering(true);

    await asTerminal(() => deleting("delete").run(["team_1"]));

    expect(talk.asked()).toEqual(["Delete team team_1 in project proj_env on localhost:8112?"]);
  });

  it("spells out a control character in the id it asks about", async () => {
    const talk = answering(true);

    await asTerminal(() => deleting("delete").run(["team\u001b]0;x\u0007"]));

    expect(talk.asked()).toEqual([
      "Delete team team\\x1b]0;x\\x07 in project proj_env on api.zitadel.example?",
    ]);
  });

  it("closes on what it deleted as one line when the id has a line break in it", async () => {
    const talk = answering(true);

    await asTerminal(() => deleting("delete").run(["a\nb"]));

    expect(talk.plain()).toContain("Deleted team a\\x0ab");
  });

  it("is skipped when the answer is no", async () => {
    answering(false);

    const envelope = await asTerminal(() => deleting("delete").run(["team_1"]));

    expect(JSON.parse(JSON.stringify(envelope))).toMatchObject({
      status: "skipped",
      reason: "delete-cancelled",
    });
  });

  it("fails instead of skipping on Ctrl-C", async () => {
    const talk = answering();

    await expect(asTerminal(() => deleting("delete").run(["team_1"]))).rejects.toThrow();

    expect(talk.plain()).toContain("Cancelled");
  });
});

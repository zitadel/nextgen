import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  cancel: vi.fn(),
  isCancel: vi.fn().mockReturnValue(false),
}));

import { cancel, confirm, isCancel } from "@clack/prompts";

import { asTerminal } from "../../../../helpers/terminal";
import { EXIT_CODES } from "../../../../../src/lib/errors";
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
  type OperationClass,
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
} as unknown as OperationDefinition<Ctx, GetSpec<Ctx>>["options"];
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
      expect(Object.keys(statics.flags)).toEqual(["name", "data", "file", "set", "extra"]);
      const flags = statics.flags as Record<string, { helpGroup?: string }>;
      expect(flags.name?.helpGroup).toBe("REQUIRED FIELD");
      expect(flags.data?.helpGroup).toBe("RAW BODY");
    }
  });

  it("leads the create and update examples with the required fields", () => {
    expect(CreateOperation.describe(definition(create)).examples[0]).toBe(
      "<%= config.bin %> teams create --name <name> --json",
    );
    expect(UpdateOperation.describe(definition(update)).examples[0]).toBe(
      "<%= config.bin %> teams update <id> --name <name> --json",
    );
  });

  it("names the --file example as one shell word for a multi-word resource", () => {
    const idps = <Spec>(spec: Spec): OperationDefinition<Ctx, Spec> => ({
      ...definition(spec),
      topic: "idps",
      resource: { ...resource, singular: "identity provider connection" },
    });

    expect(CreateOperation.describe(idps(create)).examples).toContain(
      "<%= config.bin %> idps create --file ./identity-provider-connection.json",
    );
    expect(UpdateOperation.describe(idps(update)).examples).toContain(
      "<%= config.bin %> idps update <id> --file ./identity-provider-connection.json",
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

  it("leads with the example a registry entry declares", () => {
    const declared: CreateSpec<Ctx> = {
      schema,
      example: "--name platform",
      call: async () => ({}),
    };

    expect(CreateOperation.describe(definition(declared)).examples[0]).toBe(
      "<%= config.bin %> teams create --name platform --json",
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
    expect(statics.examples).toEqual(["<%= config.bin %> teams delete <id> --force --json"]);
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
      topic: "users",
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

    expect(sent).toEqual({
      size: 5,
      where: [{ field: "state", operation: "equals", value: "active" }],
    });
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.next_cursor).toBe("c2");
    expect(data.next_page_token).toBeUndefined();
  });
});

describe("write results", () => {
  it("carries data and no next command when the server answers without a body", async () => {
    // `grants create` by identifier answers 202 with no body.
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
    expect(JSON.parse(JSON.stringify(envelope))).toHaveProperty("data", {});
  });

  it("suggests getting the resource an update answered with", async () => {
    const updated: UpdateSpec<Ctx> = { schema, call: async () => ({ id: "team_1", name: "a" }) };
    const command = bindOperation(
      UpdateOperation as OperationClass<Ctx, UpdateSpec<Ctx>>,
      definition(updated),
    );

    const envelope = (await (command as unknown as { run(argv: string[]): Promise<unknown> }).run([
      "team_1",
      "--name",
      "a",
      "--json",
    ])) as { data: { next_commands: string[] } };

    expect(envelope.data.next_commands[0]).toContain("teams get team_1 --json");
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
  const log = vi.spyOn(prototype, "log").mockImplementation((message?: string) => {
    stdout.push(message ?? "");
  });
  const logToStderr = vi.spyOn(prototype, "logToStderr").mockImplementation((message?: string) => {
    stderr.push(message ?? "");
  });
  try {
    await (command as { run(argv: string[]): Promise<unknown> }).run(argv);
  } catch (error) {
    throw new Error(`${String(error)}\n${stderr.join("\n")}`);
  } finally {
    log.mockRestore();
    logToStderr.mockRestore();
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

    expect(stderr.join("\n")).toContain("teams list --page-token p2 --json");
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
    const written: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const log = vi.spyOn(console, "log").mockImplementation((...args) => {
      written.push(`${args.join(" ")}\n`);
    });
    try {
      await asTerminal(() => getting.run(argv));
    } finally {
      write.mockRestore();
      log.mockRestore();
    }
    return written.join("");
  };

  it("shows a spec's sections under the fields", async () => {
    expect(await printed(["team_1"])).toContain("name  core\n\nmembers\n  ada");
  });

  it("leaves them out when --fields picks the view", async () => {
    expect(await printed(["team_1", "--fields", "name"])).not.toContain("members");
  });
});

describe("delete confirmation", () => {
  const deleting = (verb: "delete" | "revoke" | "deactivate", call = async () => undefined) =>
    bindOperation(
      DeleteOperation as OperationClass<Ctx, DeleteSpec<Ctx>>,
      definition<DeleteSpec<Ctx>>({ verb, call }),
    ) as unknown as { run(argv: string[]): Promise<unknown> };

  /** What a failing command prints, which is how an agent or a person reads the failure. */
  const printedByFailing = async (
    run: () => Promise<unknown>,
  ): Promise<{ stdout: string; stderr: string }> => {
    const written: string[] = [];
    const errors: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });
    const log = vi.spyOn(console, "log").mockImplementation((...args) => {
      written.push(`${args.join(" ")}\n`);
    });
    try {
      await run().catch(() => undefined);
    } finally {
      write.mockRestore();
      log.mockRestore();
      err.mockRestore();
    }
    return { stdout: written.join(""), stderr: errors.join("") };
  };

  afterEach(() => {
    vi.mocked(confirm).mockReset();
    vi.mocked(isCancel).mockReset();
    vi.mocked(isCancel).mockReturnValue(false);
  });

  it.each(["delete", "revoke", "deactivate"] as const)(
    "names the %s, the resource and the id when it refuses without --force",
    async (verb) => {
      const failure = JSON.parse(
        (await printedByFailing(() => deleting(verb).run(["team_1", "--json"]))).stdout,
      );

      expect(failure).toMatchObject({
        code: "E_VALIDATION",
        message: `Cannot ${verb} team team_1 without --force in non-interactive mode`,
        next_commands: [expect.stringContaining(`teams ${verb} team_1 --force`)],
      });
    },
  );

  it("asks the question with the verb, the resource and the id", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(true as never);

    await asTerminal(() => deleting("revoke").run(["team_1"]));

    expect(vi.mocked(confirm).mock.calls[0]?.[0]).toMatchObject({ message: "Revoke team team_1?" });
  });

  it("is skipped when the answer is no", async () => {
    vi.mocked(confirm).mockResolvedValueOnce(false as never);

    const envelope = await asTerminal(() => deleting("delete").run(["team_1"]));

    expect(JSON.parse(JSON.stringify(envelope))).toMatchObject({
      status: "skipped",
      reason: "delete-cancelled",
    });
  });

  it("fails instead of skipping on Ctrl-C", async () => {
    vi.mocked(isCancel).mockReturnValue(true);
    vi.mocked(confirm).mockResolvedValueOnce(Symbol("cancel") as never);

    await expect(asTerminal(() => deleting("delete").run(["team_1"]))).rejects.toThrow();

    expect(cancel).toHaveBeenCalledWith("Cancelled.");
  });
});

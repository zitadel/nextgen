import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { RESOURCES } from "../../../src/commands/resources";
import { COMMANDS } from "../../../src/index";
import { parseFilter, parseSort } from "../../../src/lib/oclif/crud";
import { parseJson, runCliForTest } from "../../helpers/run-cli";

const SERVER = "https://api.zitadel.cloud";
const OPERATIONS = ["equals", "greater_than"] as const;
const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

async function makeProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-resources-"));
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj_test",
      project_secret: "sk_proj_test_full",
      preview_secret: "sk_proj_test_preview",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00Z",
    }),
  );
  return cwd;
}

const user = (id: string) => ({
  id,
  schema: "sch_default",
  attributes: { email: `${id}@example.com` },
  identifier: `${id}@example.com`,
  identifier_property: "email",
  metadata: {
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    status: "active",
  },
});

async function run(cwd: string, argv: string[]) {
  return runCliForTest([...argv, "--cwd", cwd, "--server", SERVER, "--json", "--non-interactive"]);
}

describe("resource registry", () => {
  it("registers list/get/create/update/delete commands for every entry", () => {
    for (const [topic, resource] of Object.entries(RESOURCES)) {
      expect(COMMANDS[`${topic}:list`], `${topic}:list`).toBeDefined();
      expect(COMMANDS[`${topic}:get`], `${topic}:get`).toBeDefined();
      expect(Boolean(COMMANDS[`${topic}:create`])).toBe(Boolean(resource.create));
      expect(Boolean(COMMANDS[`${topic}:update`])).toBe(Boolean(resource.update));
      const deleteVerb = resource.delete?.verb ?? "delete";
      expect(Boolean(COMMANDS[`${topic}:${deleteVerb}`])).toBe(Boolean(resource.delete));
    }
  });

  it("advertises only filter and sort fields the generated query schemas accept", () => {
    for (const [topic, resource] of Object.entries(RESOURCES)) {
      const list = resource.list;
      if (!list || list.kind !== "query") {
        continue;
      }
      for (const field of list.filterFields) {
        const result = list.body.safeParse({
          filter: [{ field, operation: "equals", value: "x" }],
        });
        expect(result.success, `${topic} filter field ${field}`).toBe(true);
      }
      for (const field of list.sortFields) {
        const result = list.body.safeParse({ sorting: { field, direction: "asc" } });
        expect(result.success, `${topic} sort field ${field}`).toBe(true);
      }
      expect(
        list.body.safeParse({ filter: [{ field: "not_a_field", operation: "equals", value: "x" }] })
          .success,
      ).toBe(false);
    }
  });
});

describe("filter grammar", () => {
  it("parses field=op:value and defaults the operation to equals", () => {
    expect(parseFilter("status=active", ["status"], OPERATIONS)).toEqual({
      field: "status",
      operation: "equals",
      value: "active",
    });
    expect(
      parseFilter("created_at=greater_than:2026-01-01T00:00:00Z", ["created_at"], OPERATIONS),
    ).toEqual({
      field: "created_at",
      operation: "greater_than",
      value: "2026-01-01T00:00:00Z",
    });
    expect(parseFilter("id=equals:a:b", ["id"], OPERATIONS)).toEqual({
      field: "id",
      operation: "equals",
      value: "a:b",
    });
    expect(() => parseFilter("nonsense", ["id"], OPERATIONS)).toThrow(/Invalid --filter/);
  });

  it("parses field:direction and defaults to asc", () => {
    expect(parseSort("created_at:desc", ["created_at"])).toEqual({
      field: "created_at",
      direction: "desc",
    });
    expect(parseSort("created_at", ["created_at"])).toEqual({
      field: "created_at",
      direction: "asc",
    });
  });
});

describe("users list", () => {
  it("sends filters and sorting in the query body and returns a page", async () => {
    const cwd = await makeProject();
    let body: unknown;
    server.use(
      http.post(`${SERVER}/users/query`, async ({ request }) => {
        body = await request.json();
        expect(request.headers.get("authorization")).toBe("Bearer sk_proj_test_full");
        return HttpResponse.json({
          users: [user("user_1"), user("user_2")],
          next_page_token: "p2",
        });
      }),
    );

    const res = await run(cwd, [
      "users",
      "list",
      "--filter",
      "status=active",
      "--filter",
      "created_at=greater_than:2026-01-01T00:00:00Z",
      "--sort",
      "created_at:desc",
      "--limit",
      "2",
    ]);

    expect(res.exitCode).toBe(0);
    expect(body).toEqual({
      limit: 2,
      sorting: { field: "created_at", direction: "desc" },
      filter: [
        { field: "status", operation: "equals", value: "active" },
        { field: "created_at", operation: "greater_than", value: "2026-01-01T00:00:00Z" },
      ],
    });
    const json = parseJson(res.stdout) as {
      status: string;
      command: string;
      data: { items: Array<{ id: string }>; count: number; next_page_token: string | null };
    };
    expect(json.status).toBe("ok");
    expect(json.command).toBe("users:list");
    expect(json.data.count).toBe(2);
    expect(json.data.items.map((u) => u.id)).toEqual(["user_1", "user_2"]);
    expect(json.data.next_page_token).toBe("p2");
  });

  it("drains every page with --all", async () => {
    const cwd = await makeProject();
    const tokens: unknown[] = [];
    server.use(
      http.post(`${SERVER}/users/query`, async ({ request }) => {
        const body = (await request.json()) as { page_token?: string };
        tokens.push(body.page_token ?? null);
        return body.page_token
          ? HttpResponse.json({ users: [user("user_2")] })
          : HttpResponse.json({ users: [user("user_1")], next_page_token: "p2" });
      }),
    );

    const res = await run(cwd, ["users", "list", "--all"]);
    expect(res.exitCode).toBe(0);
    expect(tokens).toEqual([null, "p2"]);
    const json = parseJson(res.stdout) as { data: { count: number; next_page_token: null } };
    expect(json.data.count).toBe(2);
    expect(json.data.next_page_token).toBeNull();
  });

  it("rejects an unknown filter field before any request", async () => {
    const cwd = await makeProject();
    const res = await run(cwd, ["users", "list", "--filter", "email=a@b.c"]);
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string; hint?: string };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.hint).toContain("Filter fields");
  });

  it("emits tab-separated rows when stdout is not a terminal", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/users/query`, () =>
        HttpResponse.json({ users: [user("user_1"), user("user_2")] }),
      ),
    );
    const res = await runCliForTest([
      "users",
      "list",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--non-interactive",
    ]);
    expect(res.exitCode).toBe(0);
    // The registry's columns for users: id, schema, status, created_at.
    const rows = res.stdout.trim().split("\n");
    expect(rows).toHaveLength(2);
    expect(rows[0]?.split("\t")).toEqual([
      "user_1",
      "user_1@example.com",
      "active",
      "2026-01-01T00:00:00Z",
    ]);
    // No header, no footer, no hint: the aligned table is for a terminal.
    expect(res.stdout).not.toContain("created_at");
    expect(res.stdout).not.toContain("2 users");
  });

  it("takes --plain to force the machine form", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/users/query`, () => HttpResponse.json({ users: [user("user_1")] })),
    );
    const res = await runCliForTest([
      "users",
      "list",
      "--plain",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--non-interactive",
    ]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout.trim().split("\t")[0]).toBe("user_1");
  });
});

describe("get rendering", () => {
  const asTerminal = async <T>(run: () => Promise<T>): Promise<T> => {
    const tty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      return await run();
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: tty, configurable: true });
    }
  };

  it("lays the record out field by field on a terminal", async () => {
    const cwd = await makeProject();
    server.use(http.get(`${SERVER}/users/user_1`, () => HttpResponse.json(user("user_1"))));

    const res = await asTerminal(() =>
      runCliForTest(["users", "get", "user_1", "--cwd", cwd, "--server", SERVER, "--non-interactive"]),
    );

    expect(res.exitCode).toBe(0);
    // Headed by what identifies the user, then labelled fields — not raw JSON.
    expect(res.stdout).toContain("user_1@example.com");
    expect(res.stdout).toMatch(/status\s+active/);
    expect(res.stdout).not.toContain('"metadata": {');
  });

  it("still prints the whole object when piped", async () => {
    const cwd = await makeProject();
    server.use(http.get(`${SERVER}/users/user_1`, () => HttpResponse.json(user("user_1"))));

    const res = await runCliForTest([
      "users",
      "get",
      "user_1",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--non-interactive",
    ]);

    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ id: "user_1", schema: "sch_default" });
  });

  it("takes --fields on a terminal too", async () => {
    const cwd = await makeProject();
    server.use(http.get(`${SERVER}/users/user_1`, () => HttpResponse.json(user("user_1"))));

    const res = await asTerminal(() =>
      runCliForTest([
        "users",
        "get",
        "user_1",
        "--fields",
        "attributes.email",
        "--cwd",
        cwd,
        "--server",
        SERVER,
        "--non-interactive",
      ]),
    );

    expect(res.stdout).toMatch(/email\s+user_1@example\.com/);
    expect(res.stdout).not.toContain("status");
  });
});

describe("users get / create / update / delete", () => {
  it("gets one user by id", async () => {
    const cwd = await makeProject();
    server.use(http.get(`${SERVER}/users/user_1`, () => HttpResponse.json(user("user_1"))));
    const res = await run(cwd, ["users", "get", "user_1"]);
    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { id: string } };
    expect(json.data.id).toBe("user_1");
  });

  it("maps a platform 404 to E_NOT_FOUND", async () => {
    const cwd = await makeProject();
    server.use(
      http.get(`${SERVER}/users/user_missing`, () =>
        HttpResponse.json({ code: "user.not_found", message: "no such user" }, { status: 404 }),
      ),
    );
    const res = await run(cwd, ["users", "get", "user_missing"]);
    expect(res.exitCode).toBe(4);
    expect((parseJson(res.stdout) as { code: string }).code).toBe("E_NOT_FOUND");
  });

  it("creates a user from --data, scoping by project_id, and suggests the get command", async () => {
    const cwd = await makeProject();
    let url = "";
    let body: unknown;
    server.use(
      http.post(`${SERVER}/users`, async ({ request }) => {
        url = request.url;
        body = await request.json();
        return HttpResponse.json(user("user_new"), { status: 201 });
      }),
    );
    const res = await run(cwd, [
      "users",
      "create",
      "--data",
      JSON.stringify({ schema: "sch_default", attributes: { email: "new@example.com" } }),
    ]);
    expect(res.exitCode).toBe(0);
    expect(new URL(url).searchParams.get("project_id")).toBe("proj_test");
    expect(body).toEqual({ schema: "sch_default", attributes: { email: "new@example.com" } });
    const json = parseJson(res.stdout) as { data: { id: string; next_commands: string[] } };
    expect(json.data.id).toBe("user_new");
    expect(json.data.next_commands[0]).toContain("users get user_new");
  });

  it("creates from --file", async () => {
    const cwd = await makeProject();
    const file = join(cwd, "user.json");
    await writeFile(file, JSON.stringify({ schema: "sch_default", attributes: {} }));
    server.use(
      http.post(`${SERVER}/users`, () => HttpResponse.json(user("user_file"), { status: 201 })),
    );
    const res = await run(cwd, ["users", "create", "--file", file]);
    expect(res.exitCode).toBe(0);
    expect((parseJson(res.stdout) as { data: { id: string } }).data.id).toBe("user_file");
  });

  it("rejects a body whose field has the wrong type, without calling the API", async () => {
    const cwd = await makeProject();
    const res = await run(cwd, ["teams", "create", "--data", JSON.stringify({ name: 42 })]);
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      code: string;
      message: string;
      details: { issues: unknown[] };
    };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toBe("Body does not match the API schema");
    expect(json.details.issues.length).toBeGreaterThan(0);
  });

  it("names the missing field when --data omits a required one", async () => {
    const cwd = await makeProject();
    const res = await run(cwd, ["users", "create", "--data", JSON.stringify({ attributes: {} })]);
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { message: string; details: { missing: string[] } };
    expect(json.message).toBe("users create is missing required field: --schema");
    expect(json.details.missing).toEqual(["schema"]);
  });

  it("previews a create with --dry-run", async () => {
    const cwd = await makeProject();
    const res = await run(cwd, [
      "users",
      "create",
      "--dry-run",
      "--data",
      JSON.stringify({ schema: "sch_default", attributes: {} }),
    ]);
    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { dry_run: boolean; verb: string } };
    expect(json.data).toMatchObject({ dry_run: true, verb: "create", topic: "users" });
  });

  it("patches a user", async () => {
    const cwd = await makeProject();
    let body: unknown;
    server.use(
      http.patch(`${SERVER}/users/user_1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(user("user_1"));
      }),
    );
    const res = await run(cwd, [
      "users",
      "update",
      "user_1",
      "--data",
      JSON.stringify({ attributes: { givenName: "Ada" } }),
    ]);
    expect(res.exitCode).toBe(0);
    expect(body).toEqual({ attributes: { givenName: "Ada" } });
  });

  it("requires --force to delete non-interactively", async () => {
    const cwd = await makeProject();
    const res = await run(cwd, ["users", "delete", "user_1"]);
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { code: string; next_commands: string[] };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.next_commands[0]).toContain("users delete user_1 --force");
  });

  it("deletes with --force", async () => {
    const cwd = await makeProject();
    let called = false;
    server.use(
      http.delete(`${SERVER}/users/user_1`, () => {
        called = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const res = await run(cwd, ["users", "delete", "user_1", "--force"]);
    expect(res.exitCode).toBe(0);
    expect(called).toBe(true);
    expect((parseJson(res.stdout) as { data: unknown }).data).toEqual({
      id: "user_1",
      deleted: true,
    });
  });
});

describe("--file -", () => {
  it("fails fast when nothing is piped in, instead of waiting on the keyboard", async () => {
    const cwd = await makeProject();
    const tty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      const res = await run(cwd, ["users", "create", "--file", "-"]);
      expect(res.exitCode).toBe(3);
      const json = parseJson(res.stdout) as { code: string; message: string; hint: string };
      expect(json.code).toBe("E_VALIDATION");
      expect(json.message).toBe("--file - reads the body from a pipe, but nothing is piped in");
      expect(json.hint).toContain("--data");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: tty, configurable: true });
    }
  });
});

describe("piped output", () => {
  it("omits the project and server lines when stdout is not a terminal", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/users/query`, () => HttpResponse.json({ users: [user("user_1")] })),
    );

    // The harness captures stdout, so process.stdout.isTTY is undefined here —
    // the same condition a pipe or a redirect creates.
    const res = await runCliForTest([
      "users",
      "list",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--non-interactive",
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain("Project   ");
    expect(res.stdout).not.toContain("Server    ");
    // The result itself still travels on stdout, as one record per line.
    expect(res.stdout.trim()).toBe("user_1\tuser_1@example.com\tactive\t2026-01-01T00:00:00Z");
  });
});

describe("the drain spinner", () => {
  it("is stopped when a page fails, so it does not outlive the command", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/users/query`, () => HttpResponse.json({ code: "boom" }, { status: 500 })),
    );

    // The spinner holds a SIGINT handler between start and stop; counting them
    // proves the failing drain released it.
    const tty = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    const before = process.listenerCount("SIGINT");
    try {
      // Human mode on purpose: `--json` silences the spinner, so a run with it
      // would prove nothing.
      const res = await runCliForTest([
        "users",
        "list",
        "--all",
        "--cwd",
        cwd,
        "--server",
        SERVER,
        "--non-interactive",
        "--no-telemetry",
      ]);
      expect(res.exitCode).toBe(4);
      expect(process.listenerCount("SIGINT")).toBe(before);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: tty, configurable: true });
    }
  });
});

describe("field validation is independent of the data", () => {
  it("refuses an unknown path before any request is made", async () => {
    const cwd = await makeProject();
    // No handler is registered: reaching the server would fail the test.
    const res = await run(cwd, ["users", "list", "--fields", "id,emial"]);
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { message: string; details: { available: string[] } };
    expect(json.message).toBe("--fields has no such column: emial");
    expect(json.details.available).toContain("attributes.<key>");
  });

  it("refuses the same path on an empty page, where sampling could not judge", async () => {
    const cwd = await makeProject();
    server.use(http.post(`${SERVER}/users/query`, () => HttpResponse.json({ users: [] })));

    const res = await run(cwd, ["users", "list", "--fields", "id,emial"]);
    expect(res.exitCode).toBe(3);
    expect((parseJson(res.stdout) as { message: string }).message).toBe(
      "--fields has no such column: emial",
    );
  });

  it("accepts a path under the open attributes record", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/users/query`, () => HttpResponse.json({ users: [user("user_1")] })),
    );

    const res = await run(cwd, ["users", "list", "--fields", "id,attributes.email"]);
    expect(res.exitCode).toBe(0);
  });
});

describe("chosen columns", () => {
  it("takes --fields, resolving nested paths", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/users/query`, () => HttpResponse.json({ users: [user("user_1")] })),
    );

    const res = await run(cwd, ["users", "list", "--fields", "id,attributes.email"]);
    expect(res.exitCode).toBe(0);
    // --json is unaffected by --fields; the rows are the human rendering.
    const json = parseJson(res.stdout) as { data: { items: Array<{ schema: string }> } };
    expect(json.data.items[0]?.schema).toBe("sch_default");

    const rows = await runCliForTest([
      "users",
      "list",
      "--fields",
      "id,attributes.email",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--non-interactive",
    ]);
    expect(rows.stdout.trim()).toBe("user_1\tuser_1@example.com");
  });

  it("names the columns a record actually has when a path is wrong", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/users/query`, () => HttpResponse.json({ users: [user("user_1")] })),
    );

    const res = await run(cwd, ["users", "list", "--fields", "id,nope"]);
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      code: string;
      message: string;
      details: { missing: string[]; available: string[] };
    };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toBe("--fields has no such column: nope");
    expect(json.details.missing).toEqual(["nope"]);
    // Derived from the response schema, so an open record is reported as a
    // prefix rather than as whatever keys this page happened to carry.
    expect(json.details.available).toContain("attributes.<key>");
    expect(json.details.available).toContain("metadata.status");
  });

  it("validates --fields on get whether the output is piped or not", async () => {
    const cwd = await makeProject();
    server.use(http.get(`${SERVER}/users/user_1`, () => HttpResponse.json(user("user_1"))));

    const res = await run(cwd, ["users", "get", "user_1", "--fields", "nope"]);
    expect(res.exitCode).toBe(3);
    expect((parseJson(res.stdout) as { message: string }).message).toBe(
      "--fields has no such column: nope",
    );
  });

  it("rejects an empty --fields", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/users/query`, () => HttpResponse.json({ users: [user("user_1")] })),
    );
    const res = await run(cwd, ["users", "list", "--fields", " , "]);
    expect(res.exitCode).toBe(3);
    expect((parseJson(res.stdout) as { message: string }).message).toBe(
      "--fields needs at least one column",
    );
  });
});

describe("next page suggestion", () => {
  it("suggests a runnable next page that repeats the sorting and filters", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/users/query`, () =>
        HttpResponse.json({ users: [user("user_1")], next_page_token: "p2" }),
      ),
    );

    const res = await run(cwd, [
      "users",
      "list",
      "--limit",
      "1",
      "--sort",
      "created_at:asc",
      "--filter",
      "status=active",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { next_commands: string[] } };
    expect(json.data.next_commands).toHaveLength(1);
    expect(json.data.next_commands[0]).toContain(
      "users list --limit 1 --sort created_at:asc --filter status=active --page-token p2 --json",
    );
  });

  it("repeats the named parameters of a GET-backed list", async () => {
    const cwd = await makeProject();
    server.use(
      http.get(`${SERVER}/events`, () =>
        HttpResponse.json({ data: [{ id: "evt_1" }], next_page_token: "p2" }),
      ),
    );

    const res = await run(cwd, [
      "events",
      "list",
      "--category",
      "entity",
      "--category",
      "auth",
      "--limit",
      "1",
    ]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { next_commands: string[] } };
    expect(json.data.next_commands[0]).toContain(
      "events list --limit 1 --category entity --category auth --page-token p2 --json",
    );
  });

  it("quotes a value a shell would otherwise split", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/teams/query`, () =>
        HttpResponse.json({ teams: [], next_page_token: "p2" }),
      ),
    );

    const res = await run(cwd, ["teams", "list", "--filter", "name=contains:two words"]);
    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { next_commands: string[] } };
    expect(json.data.next_commands[0]).toContain("--filter 'name=contains:two words'");
  });

  it("suggests nothing on the last page", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/users/query`, () => HttpResponse.json({ users: [user("user_1")] })),
    );

    const res = await run(cwd, ["users", "list"]);
    const json = parseJson(res.stdout) as {
      data: { next_page_token: null; next_commands?: string[] };
    };
    expect(json.data.next_page_token).toBeNull();
    expect(json.data.next_commands).toBeUndefined();
  });

  it("suggests nothing after --all drained every page", async () => {
    const cwd = await makeProject();
    const pages = [
      { users: [user("user_1")], next_page_token: "p2" },
      { users: [user("user_2")] },
    ];
    let call = 0;
    server.use(http.post(`${SERVER}/users/query`, () => HttpResponse.json(pages[call++] ?? {})));

    const res = await run(cwd, ["users", "list", "--all"]);
    const json = parseJson(res.stdout) as { data: { next_commands?: string[] } };
    expect(json.data.next_commands).toBeUndefined();
  });
});

describe("body field flags", () => {
  it("builds the body from one flag per schema field", async () => {
    const cwd = await makeProject();
    let body: unknown;
    server.use(
      http.post(`${SERVER}/teams/query`, () => HttpResponse.json({ teams: [] })),
      http.post(`${SERVER}/teams`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "team_1", name: "platform" }, { status: 201 });
      }),
    );

    const res = await run(cwd, ["teams", "create", "--name", "platform"]);
    expect(res.exitCode).toBe(0);
    expect(body).toEqual({ name: "platform" });
  });

  it("collects repeated key=value entries into an open record", async () => {
    const cwd = await makeProject();
    let body: unknown;
    server.use(
      http.post(`${SERVER}/users`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(user("user_1"), { status: 201 });
      }),
    );

    const res = await run(cwd, [
      "users",
      "create",
      "--schema",
      "sch_default",
      "--attributes",
      "email=ada@example.com",
      "--attributes",
      "givenName=Ada",
    ]);
    expect(res.exitCode).toBe(0);
    expect(body).toEqual({
      schema: "sch_default",
      attributes: { email: "ada@example.com", givenName: "Ada" },
    });
  });

  it("lets a field flag override the same key in --data", async () => {
    const cwd = await makeProject();
    let body: unknown;
    server.use(
      http.post(`${SERVER}/teams`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "team_1", name: "flag-wins" }, { status: 201 });
      }),
    );

    const res = await run(cwd, [
      "teams",
      "create",
      "--data",
      JSON.stringify({ name: "from-data" }),
      "--name",
      "flag-wins",
    ]);
    expect(res.exitCode).toBe(0);
    expect(body).toEqual({ name: "flag-wins" });
  });

  it("rejects a value outside a field's allowed set before any request", async () => {
    const cwd = await makeProject();
    const res = await run(cwd, [
      "grants",
      "create",
      "--principal-type",
      "robot",
      "--principal-id",
      "user_1",
      "--relation",
      "viewer",
    ]);
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("robot");
  });

  it("names the required flags that are missing", async () => {
    const cwd = await makeProject();
    const res = await run(cwd, ["grants", "create", "--principal-id", "user_1"]);
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as {
      code: string;
      message: string;
      hint: string;
      details: { missing: string[] };
    };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toBe(
      "grants create is missing required fields: --principal-type, --relation",
    );
    expect(json.hint).toContain("--principal-type and --relation");
    expect(json.details.missing).toEqual(["principal_type", "relation"]);
  });

  it("accepts a required field supplied through --data instead of its flag", async () => {
    const cwd = await makeProject();
    let body: unknown;
    server.use(
      http.post(`${SERVER}/grants`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "asgn_1" }, { status: 201 });
      }),
    );

    const res = await run(cwd, [
      "grants",
      "create",
      "--data",
      JSON.stringify({ principal_type: "user", relation: "viewer" }),
      "--principal-id",
      "user_1",
    ]);
    expect(res.exitCode).toBe(0);
    expect(body).toEqual({ principal_type: "user", principal_id: "user_1", relation: "viewer" });
  });

  it("reports a single missing field in the singular", async () => {
    const cwd = await makeProject();
    const res = await run(cwd, ["users", "create", "--attributes", "email=a@b.c"]);
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { message: string; hint: string };
    expect(json.message).toBe("users create is missing required field: --schema");
    expect(json.hint).toContain("include it in --data");
  });

  it("points at both input modes when no body is given at all", async () => {
    const cwd = await makeProject();
    const res = await run(cwd, ["teams", "create"]);
    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { message: string; hint: string };
    expect(json.message).toBe("teams create needs a body");
    expect(json.hint).toContain("--help");
    expect(json.hint).toContain("--data");
  });

  it("updates through field flags too", async () => {
    const cwd = await makeProject();
    let body: unknown;
    server.use(
      http.patch(`${SERVER}/teams/team_1`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: "team_1", name: "renamed" });
      }),
    );

    const res = await run(cwd, ["teams", "update", "team_1", "--name", "renamed"]);
    expect(res.exitCode).toBe(0);
    expect(body).toEqual({ name: "renamed" });
  });
});

describe("dry runs", () => {
  it("previews a delete without --force, since it sends nothing", async () => {
    const cwd = await makeProject();
    const res = await run(cwd, ["teams", "delete", "team_1", "--dry-run"]);
    expect(res.exitCode).toBe(0);
    expect((parseJson(res.stdout) as { data: unknown }).data).toEqual({
      dry_run: true,
      verb: "delete",
      topic: "teams",
      id: "team_1",
    });
  });

  it("keeps a credential out of the preview when the body came from a file", async () => {
    const cwd = await makeProject();
    const file = join(cwd, "body.json");
    await writeFile(
      file,
      JSON.stringify({ schema: "sch_default", attributes: { password: "hunter2" } }),
    );

    const res = await run(cwd, ["users", "create", "--file", file, "--dry-run"]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).not.toContain("hunter2");
    expect(res.stdout).toContain("«redacted»");
  });
});

describe("an empty list writes nothing", () => {
  it("leaves stdout empty when piped, so `wc -l` counts no records", async () => {
    const cwd = await makeProject();
    server.use(http.post(`${SERVER}/users/query`, () => HttpResponse.json({ users: [] })));

    const res = await runCliForTest([
      "users",
      "list",
      "--cwd",
      cwd,
      "--server",
      SERVER,
      "--non-interactive",
    ]);

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("");
  });

  it("still reports the empty page in the envelope", async () => {
    const cwd = await makeProject();
    server.use(http.post(`${SERVER}/users/query`, () => HttpResponse.json({ users: [] })));

    const res = await run(cwd, ["users", "list"]);
    expect((parseJson(res.stdout) as { data: { count: number } }).data.count).toBe(0);
  });
});

describe("delete outcomes", () => {
  it("reports what a team delete actually does, rather than claiming removal", async () => {
    const cwd = await makeProject();
    server.use(
      http.delete(`${SERVER}/teams/team_1`, () => new HttpResponse(null, { status: 204 })),
    );

    const res = await run(cwd, ["teams", "delete", "team_1", "--force"]);
    expect(res.exitCode).toBe(0);
    // ADR 024: the API deactivates the team and leaves it readable.
    expect((parseJson(res.stdout) as { data: unknown }).data).toEqual({
      id: "team_1",
      deactivated: true,
    });
  });

  it("still reports a user delete as deleted", async () => {
    const cwd = await makeProject();
    server.use(
      http.delete(`${SERVER}/users/user_1`, () => new HttpResponse(null, { status: 204 })),
    );

    const res = await run(cwd, ["users", "delete", "user_1", "--force"]);
    expect((parseJson(res.stdout) as { data: unknown }).data).toEqual({
      id: "user_1",
      deleted: true,
    });
  });
});

describe("page tokens are opaque", () => {
  it("quotes a token that would otherwise be split by a shell", async () => {
    const cwd = await makeProject();
    server.use(
      http.post(`${SERVER}/users/query`, () =>
        HttpResponse.json({ users: [user("user_1")], next_page_token: "tok en;rm -rf /" }),
      ),
    );

    const res = await run(cwd, ["users", "list"]);
    const json = parseJson(res.stdout) as { data: { next_commands: string[] } };
    expect(json.data.next_commands[0]).toContain("--page-token 'tok en;rm -rf /'");
  });
});

describe("other resources", () => {
  it("sessions revoke uses the revoke verb", async () => {
    const cwd = await makeProject();
    server.use(
      http.delete(`${SERVER}/sessions/sess_1`, () => new HttpResponse(null, { status: 204 })),
    );
    const res = await run(cwd, ["sessions", "revoke", "sess_1", "--force"]);
    expect(res.exitCode).toBe(0);
    expect((parseJson(res.stdout) as { data: unknown }).data).toEqual({
      id: "sess_1",
      revoked: true,
    });
  });

  it("teams list scopes the query by project_id", async () => {
    const cwd = await makeProject();
    let url = "";
    server.use(
      http.post(`${SERVER}/teams/query`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ teams: [] });
      }),
    );
    const res = await run(cwd, ["teams", "list"]);
    expect(res.exitCode).toBe(0);
    expect(new URL(url).searchParams.get("project_id")).toBe("proj_test");
  });

  it("events list lifts flags to query parameters", async () => {
    const cwd = await makeProject();
    let url = "";
    server.use(
      http.get(`${SERVER}/events`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({
          data: [{ id: "evt_1", event_type: "user.created", category: "entity" }],
        });
      }),
    );
    const res = await run(cwd, [
      "events",
      "list",
      "--category",
      "entity",
      "--category",
      "auth",
      "--created-after",
      "2026-01-01T00:00:00Z",
      "--limit",
      "5",
    ]);
    expect(res.exitCode).toBe(0);
    const params = new URL(url).searchParams;
    expect(params.get("project_id")).toBe("proj_test");
    expect(params.getAll("category")).toEqual(["entity", "auth"]);
    expect(params.get("created_after")).toBe("2026-01-01T00:00:00Z");
    expect(params.get("limit")).toBe("5");
    const json = parseJson(res.stdout) as { data: { items: Array<{ id: string }> } };
    expect(json.data.items[0].id).toBe("evt_1");
  });
});

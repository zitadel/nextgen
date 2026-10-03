import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

const SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  preview_origins: [],
  created_at: "2026-01-01T00:00:00.000Z",
  schema_version: 2,
};

/** A flow whose user_schema is a concrete server id — pull writes it verbatim. */
const SERVER_FLOW = {
  name: "login",
  status: "active",
  user_schema: "sch_server_1",
  purposes: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      fields: [],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      transitions: { submit: { target: "done" } },
    },
    { name: "done", complete: "show" },
  ],
};

const SERVER_SCHEMA = {
  kind: "user-schema",
  metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
  objectType: "human-user",
  "x-auth-methods": { password: { enabled: true } },
  properties: { email: { type: "string" } },
};

const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await new Promise<void>((resolve) => servers.pop()?.close(() => resolve()));
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

/** A project directory; `initialized` controls whether a state file exists. */
async function makeCwd({ initialized = true }: { initialized?: boolean } = {}): Promise<string> {
  const cwd = join(tmpdir(), `zitadel-pull-test-${Math.random().toString(36).slice(2)}`);
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));
  if (initialized) {
    await writeFile(
      join(cwd, ".zitadel/state.json"),
      JSON.stringify({ framework: "next", resources: {} }),
    );
  }
  return cwd;
}

/** Serves the list-by-handle and read-by-id routes pull uses; `found` toggles an empty list. */
async function startStub({ found = true }: { found?: boolean } = {}): Promise<string> {
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const json = (body: unknown): void =>
      void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (path === "/schemas") {
      return json({ schemas: found ? [{ id: "sch_server_1", schema: SERVER_SCHEMA }] : [] });
    }
    if (path.startsWith("/schemas/")) {
      return json({ id: "sch_server_1", schema: SERVER_SCHEMA, metadata: {} });
    }
    if (path === "/flow_definitions") {
      return json({
        flow_definitions: found ? [{ id: "flowdef_server_1", flow_definition: SERVER_FLOW }] : [],
      });
    }
    if (path.startsWith("/flow_definitions/")) {
      return json({ id: "flowdef_server_1", flow_definition: SERVER_FLOW });
    }
    res.writeHead(404).end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  servers.push(server);
  return `http://localhost:${(server.address() as { port: number }).port}`;
}

function pull(cwd: string, base: string, args: string[]) {
  return runCliForTest(["pull", ...args, "--cwd", cwd, "--json", "--server", base]);
}

describe("pull command", () => {
  it("localizes the flow's user_schema to the schema handle and reports it in the envelope", async () => {
    const cwd = await makeCwd();
    const base = await startStub();

    const res = await pull(cwd, base, ["flow", "login"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { kind: string; handle: string; id: string; path: string } };
    expect(json.data).toMatchObject({
      kind: "flow",
      handle: "login",
      id: "flowdef_server_1",
      path: ".zitadel/flows/login.json",
    });
    const written = JSON.parse(await readFile(join(cwd, ".zitadel/flows/login.json"), "utf8"));
    // The concrete sch_ id becomes the schema's object-type handle.
    expect(written.user_schema).toBe("human-user");
  });

  it("suggests plan for an initialized project", async () => {
    const cwd = await makeCwd({ initialized: true });
    const base = await startStub();

    const res = await pull(cwd, base, ["flow", "login"]);

    const json = parseJson(res.stdout) as { data: { next_commands: string[] } };
    expect(json.data.next_commands.join(" ")).toContain("plan");
  });

  it("writes but suggests nothing when there is no state file", async () => {
    const cwd = await makeCwd({ initialized: false });
    const base = await startStub();

    const res = await pull(cwd, base, ["flow", "login"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { next_commands: string[] } };
    expect(json.data.next_commands).toEqual([]);
    expect(await stat(join(cwd, ".zitadel/flows/login.json"))).toBeTruthy();
  });

  it("updates the existing file that tracks the handle under a different name", async () => {
    const cwd = await makeCwd();
    await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/schemas/default-human-user.json"),
      JSON.stringify({ kind: "user-schema", objectType: "human-user", properties: {} }),
    );
    const base = await startStub();

    const res = await pull(cwd, base, ["schema", "human-user"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { path: string } };
    // Writes back the tracked file, not a second human-user.json.
    expect(json.data.path).toBe(".zitadel/schemas/default-human-user.json");
    await expect(stat(join(cwd, ".zitadel/schemas/human-user.json"))).rejects.toThrow();
  });

  it("fails rather than duplicating when an existing file cannot be parsed", async () => {
    const cwd = await makeCwd();
    await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/schemas/default-human-user.json"), "{ not json");
    const base = await startStub();

    const res = await pull(cwd, base, ["schema", "human-user"]);

    expect(res.exitCode).not.toBe(0);
    await expect(stat(join(cwd, ".zitadel/schemas/human-user.json"))).rejects.toThrow();
  });

  it("writes nothing under --dry-run", async () => {
    const cwd = await makeCwd();
    const base = await startStub();

    const res = await pull(cwd, base, ["schema", "human-user", "--dry-run"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { data: { dry_run: boolean } };
    expect(json.data.dry_run).toBe(true);
    await expect(stat(join(cwd, ".zitadel/schemas/human-user.json"))).rejects.toThrow();
  });

  it("fails with E_NOT_FOUND when the handle names nothing", async () => {
    const cwd = await makeCwd();
    const base = await startStub({ found: false });

    const res = await pull(cwd, base, ["flow", "missing"]);

    expect(res.exitCode).not.toBe(0);
    expect((parseJson(res.stdout) as { code: string }).code).toBe("E_NOT_FOUND");
  });

  it("rejects a handle that is not a single path segment", async () => {
    const cwd = await makeCwd();
    const base = await startStub();

    const res = await pull(cwd, base, ["schema", "../escape"]);

    expect((parseJson(res.stdout) as { code: string }).code).toBe("E_VALIDATION");
  });

  it("rejects a handle too long to be a filename", async () => {
    const cwd = await makeCwd();
    const base = await startStub();

    const res = await pull(cwd, base, ["schema", "a".repeat(251)]);

    expect((parseJson(res.stdout) as { code: string }).code).toBe("E_VALIDATION");
  });

  it("refuses a kind whose syncer cannot pull", async () => {
    const cwd = await makeCwd();
    const base = await startStub();

    const res = await pull(cwd, base, ["branding", "whatever"]);

    expect((parseJson(res.stdout) as { code: string }).code).toBe("E_VALIDATION");
  });
});

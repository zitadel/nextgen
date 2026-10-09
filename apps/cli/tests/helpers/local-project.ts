import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";

/**
 * Projects on disk for the unit tests that run a command against local files:
 * the `auth-method` commands and what they read. The specs' counterpart is
 * `ScaffoldedApp` in `project.ts`, which runs `setup` instead.
 *
 * Temp dirs are left for the OS to reclaim, as the integration helper does
 * (#1498): a recursive delete on teardown flakes under CI load.
 */

/** What a Project holds, by file name without `.json`. */
export type ProjectFiles = {
  readonly schemas?: Record<string, unknown>;
  readonly flows?: Record<string, unknown>;
  /**
   * Whether the Project is linked the way `zitadel setup` leaves it: a
   * development issuer in `zitadel.json` and a `.zitadel/secret`. Only a
   * command that publishes to the project reads them.
   */
  readonly linked?: boolean;
};

/** Write a Project with these schemas and flows to a new temp dir. */
export async function makeProject({
  schemas = {},
  flows = {},
  linked = false,
}: ProjectFiles = {}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-project-"));
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  await writeJson(cwd, "zitadel.json", {
    version: "0.0.1",
    ...(linked ? { environments: { development: { issuer: "http://localhost:3000" } } } : {}),
  });
  if (linked) {
    await writeJson(cwd, ".zitadel/secret", {
      project_id: "proj_01TEST",
      project_secret: "s",
      preview_secret: "s",
      preview_origins: [],
      created_at: new Date().toISOString(),
    });
  }
  for (const [name, body] of Object.entries(schemas)) {
    await writeJson(cwd, `.zitadel/schemas/${name}.json`, body);
  }
  for (const [name, body] of Object.entries(flows)) {
    await writeJson(cwd, `.zitadel/flows/${name}.json`, body);
  }
  return cwd;
}

/** The scaffolded schema, cut to what `auth-method sso enable` reads. */
export const defaultSchema = {
  properties: { email: { type: "string" } },
  "x-auth-methods": { password: { enabled: true }, passkey: { enabled: true } },
};

/**
 * A Project as `zitadel setup` leaves it, minus what `auth-method sso enable`
 * ignores. Every schema gets the login flow that runs against it: the provider
 * is offered by a flow, so a project without one is not a project the command
 * can configure.
 */
export async function setUpProject(
  schemas: Record<string, unknown> = { "default-human-user": defaultSchema },
): Promise<string> {
  const cwd = await makeProject({
    schemas,
    flows: Object.fromEntries(
      Object.keys(schemas).map((name) => [`${name}-login`, loginFlow(name)]),
    ),
    linked: true,
  });
  // The README that ships beside the schemas must not be read as one.
  await writeFile(join(cwd, ".zitadel/schemas/README.md"), "# schemas\n");
  return cwd;
}

/** A login flow bound to a schema by the URL the scaffold writes. */
export function loginFlow(schemaName: string) {
  return {
    name: `${schemaName}-login`,
    status: "active",
    user_schema: `https://schemas.test.invalid/${schemaName}.json`,
    purposes: { login: "identifier", register: "register" },
    steps: [
      {
        name: "identifier",
        fields: ["email"],
        actions: [{ name: "submit", kind: "submit", primary: true }],
        // A flow serving both purposes routes each to the other, or the
        // validator (and so `auth-method sso enable`) rejects it.
        transitions: { submit: { target: "done" }, user_not_found: { target: "register" } },
      },
      {
        name: "register",
        fields: ["email"],
        actions: [{ name: "submit", kind: "submit", primary: true }],
        transitions: { submit: { target: "done" }, user_already_exists: { target: "identifier" } },
      },
      { name: "done", complete: "show" },
    ],
  };
}

/** Write one file into a Project, for a test whose input is that file. */
export async function writeJson(cwd: string, path: string, body: unknown): Promise<void> {
  await writeFile(join(cwd, path), `${JSON.stringify(body)}\n`);
}

/** Read one JSON file back out of a Project. */
export async function readJson(cwd: string, path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(cwd, path), "utf8")) as Record<string, unknown>;
}

/**
 * Run a command with a stand-in stdin, the way `variables` does: a scripted
 * run reads the secret from the stream, so leaving the real one in place
 * would block on a stream that never ends. Passing no `piped` value stands
 * for a terminal — nothing was piped.
 */
export async function withStdin<T>(piped: string | undefined, run: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(process, "stdin");
  Object.defineProperty(process, "stdin", {
    value: piped === undefined ? { isTTY: true } : Readable.from([piped]),
    configurable: true,
  });
  try {
    return await run();
  } finally {
    if (original) {
      Object.defineProperty(process, "stdin", original);
    }
  }
}

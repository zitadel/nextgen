import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDoctor } from "../../../../src/lib/commands/doctor";
import type { CliIO, GlobalOptions } from "../../../../src/io/output";
import { ZitadelError } from "../../../../src/lib/errors";
import { MANAGED_MARKER } from "../../../../src/lib/paths";

let captured = "";

function makeIO(env: Record<string, string> = {}): CliIO {
  captured = "";
  return {
    stdout: {
      write: (chunk: string): boolean => {
        captured += chunk;
        return true;
      },
    } as never,
    stderr: { write: (): boolean => true } as never,
    env,
    isTTY: false,
  };
}

function makeOpts(
  cwd: string,
  overrides: Partial<GlobalOptions & { fix?: boolean }> = {},
): GlobalOptions & { fix?: boolean } {
  return {
    cwd,
    json: true,
    nonInteractive: true,
    dryRun: false,
    force: false,
    command: "doctor",
    cliVersion: "0.0.0",
    source: "mock",
    verbose: false,
    debug: false,
    ...overrides,
  };
}

function parseEnvelope(): Record<string, unknown> {
  return JSON.parse(captured) as Record<string, unknown>;
}

type Check = { name: string; status: "pass" | "fail"; message: string; path?: string };

const tempDirs: string[] = [];

const VALID_USER_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { email: { type: "string" } },
};

/**
 * Builds a well-formed managed project that should pass every doctor check
 * runnable without the platform: config/secret parse + match, 0600 secret,
 * gitignore + env.example coverage, a Next.js framework signature, a valid
 * user schema, and managed login/register/middleware files carrying the marker.
 */
async function makeHealthyProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-doctor-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await mkdir(join(cwd, "app/login"), { recursive: true });
  await mkdir(join(cwd, "app/register"), { recursive: true });

  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
  );
  await writeFile(
    join(cwd, "zitadel.json"),
    JSON.stringify({
      project: "proj-001",
      server: "https://api.zitadel.cloud",
      framework: { id: "next" },
      environments: { development: { issuer: "http://localhost:3000" } },
    }),
  );
  await writeFile(
    join(cwd, ".zitadel/secret"),
    JSON.stringify({
      project_id: "proj-001",
      project_secret: "sk_proj_test",
      preview_secret: "sk_proj_preview",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    }),
  );
  await chmod(join(cwd, ".zitadel/secret"), 0o600);
  await writeFile(
    join(cwd, ".gitignore"),
    [".zitadel/secret", ".env*", "!.env.example"].join("\n"),
  );
  await writeFile(
    join(cwd, ".env.example"),
    ["ZITADEL_PROJECT_ID=", "ZITADEL_ENVIRONMENT=", "ZITADEL_ISSUER="].join("\n"),
  );
  await writeFile(join(cwd, ".zitadel/schemas/user.json"), JSON.stringify(VALID_USER_SCHEMA));
  await writeFile(join(cwd, "app/login/page.tsx"), `${MANAGED_MARKER}\nexport default function L() {}\n`);
  await writeFile(
    join(cwd, "app/register/page.tsx"),
    `${MANAGED_MARKER}\nexport default function R() {}\n`,
  );
  await writeFile(join(cwd, "middleware.ts"), `${MANAGED_MARKER}\nexport function middleware() {}\n`);
  return cwd;
}

function checksFromError(error: unknown): Check[] {
  expect(error).toBeInstanceOf(ZitadelError);
  const details = (error as ZitadelError).details as { checks: Check[] };
  return details.checks;
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("runDoctor", () => {
  it("passes every check for a well-formed managed project", async () => {
    const cwd = await makeHealthyProject();
    const io = makeIO();
    await runDoctor(io, makeOpts(cwd));

    const envelope = parseEnvelope();
    expect(envelope.status).toBe("ok");
    const data = envelope.data as { ok: boolean; checks: Check[] };
    expect(data.ok).toBe(true);
    expect(data.checks.every((check) => check.status === "pass")).toBe(true);
    // Sanity: the full battery actually ran.
    const names = data.checks.map((check) => check.name);
    expect(names).toContain("config");
    expect(names).toContain("secret");
    expect(names).toContain("project-match");
  });

  it("fails the managed-login check when the login page is missing", async () => {
    const cwd = await makeHealthyProject();
    await rm(join(cwd, "app/login/page.tsx"));

    const io = makeIO();
    let thrown: unknown;
    await runDoctor(io, makeOpts(cwd)).catch((error: unknown) => {
      thrown = error;
    });

    expect(thrown).toBeInstanceOf(ZitadelError);
    expect((thrown as ZitadelError).code).toBe("E_VALIDATION");
    const checks = checksFromError(thrown);
    const login = checks.find((check) => check.name === "managed-login");
    expect(login?.status).toBe("fail");
  });

  it("fails the project-match check when secret and config disagree", async () => {
    const cwd = await makeHealthyProject();
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({
        project_id: "different-id",
        project_secret: "sk_proj_test",
        preview_secret: "sk_proj_preview",
        preview_origins: [],
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    await chmod(join(cwd, ".zitadel/secret"), 0o600);

    const io = makeIO();
    let thrown: unknown;
    await runDoctor(io, makeOpts(cwd)).catch((error: unknown) => {
      thrown = error;
    });

    const checks = checksFromError(thrown);
    const match = checks.find((check) => check.name === "project-match");
    expect(match?.status).toBe("fail");
  });

  it("fails the schema check when the user schema is not valid JSON Schema", async () => {
    const cwd = await makeHealthyProject();
    // `type` must be a string/array of strings; a number makes the schema invalid.
    await writeFile(join(cwd, ".zitadel/schemas/user.json"), JSON.stringify({ type: 123 }));

    const io = makeIO();
    let thrown: unknown;
    await runDoctor(io, makeOpts(cwd)).catch((error: unknown) => {
      thrown = error;
    });

    const checks = checksFromError(thrown);
    const schema = checks.find((check) => check.name === "schema");
    expect(schema?.status).toBe("fail");
  });

  it("re-applies a missing managed login page via --fix and then passes", async () => {
    const cwd = await makeHealthyProject();
    await rm(join(cwd, "app/login/page.tsx"));

    const io = makeIO();
    await runDoctor(io, makeOpts(cwd, { fix: true }));

    const envelope = parseEnvelope();
    expect(envelope.status).toBe("ok");
    const data = envelope.data as { ok: boolean; checks: Check[] };
    expect(data.ok).toBe(true);
    const login = data.checks.find((check) => check.name === "managed-login");
    expect(login?.status).toBe("pass");
  });
});

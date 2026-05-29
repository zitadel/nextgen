import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";
import { MANAGED_MARKER } from "../../../src/lib/paths";

type Check = { name: string; status: "pass" | "fail"; message: string; path?: string };

const tempDirs: string[] = [];

const VALID_USER_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: { email: { type: "string" } },
};

function doctor(cwd: string, extra: string[] = []) {
  return runCliForTest([
    "doctor",
    "--cwd",
    cwd,
    "--json",
    "--server",
    "https://api.zitadel.cloud",
    ...extra,
  ]);
}

/**
 * Builds a well-formed managed project that should pass every doctor check
 * runnable without the platform: config/secret parse + match, 0600 secret,
 * gitignore + env.example coverage, a Next.js framework signature, a valid
 * user schema, and a Zitadel SDK dependency.
 */
async function makeHealthyProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-doctor-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await mkdir(join(cwd, "app/login"), { recursive: true });
  await mkdir(join(cwd, "app/register"), { recursive: true });

  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "demo",
      dependencies: { next: "^15", "@zitadel-nextgen/sdk-next": "latest" },
    }),
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

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("doctor command", () => {
  it("passes every check for a well-formed managed project", async () => {
    const cwd = await makeHealthyProject();
    const res = await doctor(cwd);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; data: { ok: boolean; checks: Check[] } };
    expect(json.status).toBe("ok");
    expect(json.data.ok).toBe(true);
    expect(json.data.checks.every((check) => check.status === "pass")).toBe(true);
    // Sanity: the full battery actually ran, and the page checks are gone.
    const names = json.data.checks.map((check) => check.name);
    expect(names).toContain("config");
    expect(names).toContain("secret");
    expect(names).toContain("dependency");
    expect(names).toContain("project-match");
    expect(names).not.toContain("managed-login");
    expect(names).not.toContain("managed-register");
    expect(names).not.toContain("managed-middleware");
  });

  it("fails the dependency check when no @zitadel package is present", async () => {
    const cwd = await makeHealthyProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
    );

    const res = await doctor(cwd);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string; details: { checks: Check[] } };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    const dependency = json.details.checks.find((check) => check.name === "dependency");
    expect(dependency?.status).toBe("fail");
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

    const res = await doctor(cwd);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { details: { checks: Check[] } };
    const match = json.details.checks.find((check) => check.name === "project-match");
    expect(match?.status).toBe("fail");
  });

  it("fails the schema check when the user schema is not valid JSON Schema", async () => {
    const cwd = await makeHealthyProject();
    // `type` must be a string/array of strings; a number makes the schema invalid.
    await writeFile(join(cwd, ".zitadel/schemas/user.json"), JSON.stringify({ type: 123 }));

    const res = await doctor(cwd);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { details: { checks: Check[] } };
    const schema = json.details.checks.find((check) => check.name === "schema");
    expect(schema?.status).toBe("fail");
  });

  it("re-locks loose secret permissions via --fix and then passes", async () => {
    const cwd = await makeHealthyProject();
    await chmod(join(cwd, ".zitadel/secret"), 0o644);

    const res = await doctor(cwd, ["--fix"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; data: { ok: boolean; checks: Check[] } };
    expect(json.status).toBe("ok");
    const perms = json.data.checks.find((check) => check.name === "secret-permissions");
    expect(perms?.status).toBe("pass");
  });

  it("reports E_VALIDATION (not a crash) when --fix cannot repair a broken project", async () => {
    const cwd = await makeHealthyProject();
    // Remove the user schema: schema check fails outright, and dependency's
    // repair can't rebuild its context — --fix must stay best-effort.
    await rm(join(cwd, ".zitadel/schemas/user.json"));
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
    );

    const res = await doctor(cwd, ["--fix"]);

    expect(res.exitCode).toBe(3);
    const json = parseJson(res.stdout) as { status: string; code: string; details: { checks: Check[] } };
    expect(json.status).toBe("error");
    expect(json.code).toBe("E_VALIDATION");
    expect(json.details.checks.find((check) => check.name === "schema")?.status).toBe("fail");
  });

  it("re-applies a missing Zitadel dependency via --fix and then passes", async () => {
    const cwd = await makeHealthyProject();
    // Drop the SDK dependency; repair re-adds it via its `add-dep` op.
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^15" } }),
    );

    const res = await doctor(cwd, ["--fix"]);

    expect(res.exitCode).toBe(0);
    const json = parseJson(res.stdout) as { status: string; data: { ok: boolean; checks: Check[] } };
    expect(json.status).toBe("ok");
    expect(json.data.ok).toBe(true);
    const dependency = json.data.checks.find((check) => check.name === "dependency");
    expect(dependency?.status).toBe("pass");
  });
});

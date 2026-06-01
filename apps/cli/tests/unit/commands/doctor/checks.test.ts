import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ConfigCheck,
  DependencyCheck,
  EnvExampleCheck,
  FrameworkCheck,
  GitignoreCheck,
  ProjectMatchCheck,
  SchemaCheck,
  SecretCheck,
  SecretPermissionsCheck,
  type CheckContext,
} from "../../../../src/commands/doctor/checks";
import { loadPatchContext } from "../../../../src/commands/doctor/patch-context";
import { createOrca } from "../../../../src/lib/orca";
import { MANAGED_MARKER } from "../../../../src/lib/paths";

const tempDirs: string[] = [];

// Matches the generated `CreateSchemaBody` zod (the `user-schema` branch):
// required keys are `kind`, `metaSchema`, `x-auth-methods`.
const VALID_USER_SCHEMA = {
  kind: "user-schema",
  metaSchema: "https://nextgen.com/api/schemas/user-schema.json",
  "x-auth-methods": { passkey: { enabled: true, position: 0 } },
  properties: { email: { type: "string" } },
};

const SECRET = {
  project_id: "proj-001",
  project_secret: "sk_proj_test",
  preview_secret: "sk_proj_preview",
  preview_origins: [],
  created_at: "2026-01-01T00:00:00.000Z",
};

/** A fully healthy Next.js managed project: every check passes against it. */
async function makeProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-checks-"));
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
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));
  await chmod(join(cwd, ".zitadel/secret"), 0o600);
  await writeFile(join(cwd, ".gitignore"), [".zitadel/secret", ".env*", "!.env.example"].join("\n"));
  await writeFile(
    join(cwd, ".env.example"),
    ["ZITADEL_PROJECT_ID=", "ZITADEL_ENVIRONMENT=", "ZITADEL_ISSUER="].join("\n"),
  );
  await writeFile(join(cwd, ".zitadel/schemas/user.json"), JSON.stringify(VALID_USER_SCHEMA));
  await writeFile(join(cwd, "app/login/page.tsx"), `${MANAGED_MARKER}\nexport default function L() {}\n`);
  await writeFile(join(cwd, "app/register/page.tsx"), `${MANAGED_MARKER}\nexport default function R() {}\n`);
  await writeFile(join(cwd, "middleware.ts"), `${MANAGED_MARKER}\nexport function middleware() {}\n`);
  return cwd;
}

function ctxFor(cwd: string, dryRun = false): CheckContext {
  return { cwd, orca: createOrca(), dryRun };
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("ConfigCheck", () => {
  it("passes when zitadel.json parses", async () => {
    const cwd = await makeProject();
    expect((await new ConfigCheck().run(ctxFor(cwd))).status).toBe("pass");
  });

  it("fails when zitadel.json is missing", async () => {
    const cwd = await makeProject();
    await rm(join(cwd, "zitadel.json"));
    expect((await new ConfigCheck().run(ctxFor(cwd))).status).toBe("fail");
  });

  it("has a no-op fix (no override) that does not throw", async () => {
    const cwd = await makeProject();
    await expect(new ConfigCheck().fix(ctxFor(cwd))).resolves.toBeUndefined();
  });
});

describe("SecretCheck", () => {
  it("passes when .zitadel/secret parses", async () => {
    const cwd = await makeProject();
    expect((await new SecretCheck().run(ctxFor(cwd))).status).toBe("pass");
  });

  it("fails when .zitadel/secret is missing", async () => {
    const cwd = await makeProject();
    await rm(join(cwd, ".zitadel/secret"));
    expect((await new SecretCheck().run(ctxFor(cwd))).status).toBe("fail");
  });
});

describe("SecretPermissionsCheck", () => {
  it("passes at 0600 and fails at 0644", async () => {
    const cwd = await makeProject();
    expect((await new SecretPermissionsCheck().run(ctxFor(cwd))).status).toBe("pass");
    await chmod(join(cwd, ".zitadel/secret"), 0o644);
    expect((await new SecretPermissionsCheck().run(ctxFor(cwd))).status).toBe("fail");
  });

  it("fix re-locks the secret to 0600", async () => {
    const cwd = await makeProject();
    await chmod(join(cwd, ".zitadel/secret"), 0o644);
    await new SecretPermissionsCheck().fix(ctxFor(cwd));
    expect((await stat(join(cwd, ".zitadel/secret"))).mode & 0o777).toBe(0o600);
  });

  it("fix is a no-op under dryRun", async () => {
    const cwd = await makeProject();
    await chmod(join(cwd, ".zitadel/secret"), 0o644);
    await new SecretPermissionsCheck().fix(ctxFor(cwd, true));
    expect((await stat(join(cwd, ".zitadel/secret"))).mode & 0o777).toBe(0o644);
  });
});

describe("GitignoreCheck", () => {
  it("fails when an entry is missing, then fix appends it", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, ".gitignore"), ".zitadel/secret\n");
    const check = new GitignoreCheck();
    expect((await check.run(ctxFor(cwd))).status).toBe("fail");

    await check.fix(ctxFor(cwd));

    expect((await check.run(ctxFor(cwd))).status).toBe("pass");
    const contents = await readFile(join(cwd, ".gitignore"), "utf8");
    expect(contents).toContain(".env*");
    expect(contents).toContain("!.env.example");
  });

  it("fix creates .gitignore when it is absent", async () => {
    const cwd = await makeProject();
    await rm(join(cwd, ".gitignore"));
    const check = new GitignoreCheck();
    await check.fix(ctxFor(cwd));
    expect((await check.run(ctxFor(cwd))).status).toBe("pass");
  });

  it("fix is a no-op under dryRun", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, ".gitignore"), ".zitadel/secret\n");
    const check = new GitignoreCheck();
    await check.fix(ctxFor(cwd, true));
    expect((await check.run(ctxFor(cwd))).status).toBe("fail");
  });
});

describe("EnvExampleCheck", () => {
  it("fails when a key is missing, then fix appends it", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, ".env.example"), "ZITADEL_PROJECT_ID=\n");
    const check = new EnvExampleCheck();
    expect((await check.run(ctxFor(cwd))).status).toBe("fail");

    await check.fix(ctxFor(cwd));

    expect((await check.run(ctxFor(cwd))).status).toBe("pass");
    const contents = await readFile(join(cwd, ".env.example"), "utf8");
    expect(contents).toContain("ZITADEL_ISSUER=");
  });

  it("fix is a no-op under dryRun", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, ".env.example"), "ZITADEL_PROJECT_ID=\n");
    const check = new EnvExampleCheck();
    await check.fix(ctxFor(cwd, true));
    expect((await check.run(ctxFor(cwd))).status).toBe("fail");
  });
});

describe("FrameworkCheck", () => {
  it("passes when detected framework matches the recorded one", async () => {
    const cwd = await makeProject();
    expect((await new FrameworkCheck().run(ctxFor(cwd))).status).toBe("pass");
  });

  it("fails when the recorded framework disagrees with detection", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({ project: "proj-001", server: "x", framework: { id: "vue" } }),
    );
    expect((await new FrameworkCheck().run(ctxFor(cwd))).status).toBe("fail");
  });
});

describe("SchemaCheck", () => {
  it("passes for a valid JSON Schema", async () => {
    const cwd = await makeProject();
    expect((await new SchemaCheck().run(ctxFor(cwd))).status).toBe("pass");
  });

  it("fails for a malformed JSON Schema", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, ".zitadel/schemas/user.json"), JSON.stringify({ type: 123 }));
    expect((await new SchemaCheck().run(ctxFor(cwd))).status).toBe("fail");
  });

  it("fails when the kind discriminator is missing", async () => {
    const cwd = await makeProject();
    // Valid JSON Schema, but no `kind: "user-schema" | "schema-url"` —
    // the platform would reject this at apply; doctor must catch it locally.
    await writeFile(
      join(cwd, ".zitadel/schemas/user.json"),
      JSON.stringify({ type: "object", properties: { email: { type: "string" } } }),
    );
    const outcome = await new SchemaCheck().run(ctxFor(cwd));
    expect(outcome.status).toBe("fail");
  });
});

describe("DependencyCheck", () => {
  it("passes when a @zitadel package is declared", async () => {
    const cwd = await makeProject();
    expect((await new DependencyCheck().run(ctxFor(cwd))).status).toBe("pass");
  });

  it("fails when no @zitadel package is present", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "demo", dependencies: { next: "^15" } }));
    expect((await new DependencyCheck().run(ctxFor(cwd))).status).toBe("fail");
  });

  it("fix re-adds the SDK dependency via the patcher", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "demo", dependencies: { next: "^15" } }));
    const check = new DependencyCheck();
    expect((await check.run(ctxFor(cwd))).status).toBe("fail");

    await check.fix(ctxFor(cwd));

    expect((await check.run(ctxFor(cwd))).status).toBe("pass");
  });
});

describe("ProjectMatchCheck", () => {
  it("passes when secret project_id matches config project", async () => {
    const cwd = await makeProject();
    expect((await new ProjectMatchCheck().run(ctxFor(cwd))).status).toBe("pass");
  });

  it("fails when secret project_id disagrees with config project", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify({ ...SECRET, project_id: "other" }));
    await chmod(join(cwd, ".zitadel/secret"), 0o600);
    expect((await new ProjectMatchCheck().run(ctxFor(cwd))).status).toBe("fail");
  });
});

describe("loadPatchContext", () => {
  it("reconstructs the patch context from on-disk project files", async () => {
    const cwd = await makeProject();
    const ctx = await loadPatchContext(cwd, createOrca());

    expect(ctx.framework.id).toBe("next");
    expect(ctx.project.id).toBe("proj-001");
    expect(ctx.issuer).toBe("http://localhost:3000");
    expect(ctx.userFields).toEqual(["email"]);
  });
});

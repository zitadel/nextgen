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
  ManagedFilesCheck,
  ProjectMatchCheck,
  SchemaCheck,
  SecretCheck,
  SecretPermissionsCheck,
  type CheckContext,
} from "../../../../src/commands/doctor/checks";
import { loadPatchContext } from "../../../../src/commands/doctor/patch-context";
import { createOrca } from "../../../../src/lib/orca";
import { MANAGED_MARKER } from "../../../../src/lib/paths";
import { hashScaffoldFile } from "../../../../src/lib/scaffold-manifest";
import type { ScaffoldManifest } from "../../../../src/lib/sync/types";

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
  await mkdir(join(cwd, "app/profile"), { recursive: true });

  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "demo",
      dependencies: { next: "^15", "@zitadel/sdk-next": "latest" },
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
  await writeFile(join(cwd, "app/profile/page.tsx"), `${MANAGED_MARKER}\nexport default function P() {}\n`);
  await writeFile(join(cwd, "middleware.ts"), `${MANAGED_MARKER}\nexport function middleware() {}\n`);
  await writeFile(join(cwd, "custom-elements.d.ts"), `${MANAGED_MARKER}\nexport {};\n`);
  return cwd;
}

/** Writes `.zitadel/state.json` carrying a scaffold manifest section. */
async function writeScaffoldState(cwd: string, scaffold: ScaffoldManifest): Promise<void> {
  await writeFile(
    join(cwd, ".zitadel/state.json"),
    JSON.stringify({ framework: "next", resources: {}, scaffold }),
  );
}

async function readScaffoldState(cwd: string): Promise<ScaffoldManifest> {
  const state = JSON.parse(await readFile(join(cwd, ".zitadel/state.json"), "utf8")) as {
    scaffold: ScaffoldManifest;
  };
  return state.scaffold;
}

function ctxFor(cwd: string, dryRun = false): CheckContext {
  return { cwd, orca: createOrca(), cliVersion: "0.1.0-alpha.0", dryRun };
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

  it("fix reclaims proxy.ts for Next 16 projects", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, "package.json"), JSON.stringify({ name: "demo", dependencies: { next: "^16" } }));
    await rm(join(cwd, "middleware.ts"));

    await new DependencyCheck().fix(ctxFor(cwd));

    await expect(readFile(join(cwd, "proxy.ts"), "utf8")).resolves.toContain(
      "export function proxy(",
    );
    await expect(readFile(join(cwd, "middleware.ts"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

describe("ManagedFilesCheck", () => {
  type ManagedDetails = {
    mode: "manifest" | "template";
    files: Array<{ path: string; class: string; state: string }>;
  };

  it("passes for a healthy scaffold without a manifest (template mode)", async () => {
    const cwd = await makeProject();
    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("pass");
    const details = outcome.details as ManagedDetails;
    expect(details.mode).toBe("template");
    // The framework home page is conditionally scaffolded (fresh apps only)
    // and must not be demanded of a pre-existing app without a manifest.
    expect(details.files.map((file) => file.path)).not.toContain("app/page.tsx");
    expect(details.files).toHaveLength(5);
  });

  it("fails when an infrastructure file is missing", async () => {
    const cwd = await makeProject();
    await rm(join(cwd, "middleware.ts"));

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("fail");
    expect(outcome.message).toContain("middleware.ts");
  });

  it("warns (not fails) when a presentation page is missing", async () => {
    const cwd = await makeProject();
    await rm(join(cwd, "app/login/page.tsx"));

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("warn");
    expect(outcome.message).toContain("app/login/page.tsx");
  });

  it("passes for a user-adopted page (marker removed)", async () => {
    const cwd = await makeProject();
    await writeFile(join(cwd, "app/register/page.tsx"), "export default function Mine() {}\n");

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("pass");
    const details = outcome.details as ManagedDetails;
    expect(details.files.find((file) => file.path === "app/register/page.tsx")?.state).toBe(
      "adopted",
    );
  });

  it("warns instead of failing when nothing can be enumerated", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-checks-bare-"));
    tempDirs.push(cwd);

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("warn");
    expect(outcome.message).toContain("Could not enumerate");
  });

  it("template-mode fix restores a deleted boundary and leaves an edited page untouched", async () => {
    const cwd = await makeProject();
    const editedLogin = `${MANAGED_MARKER}\nexport default function L() { return "custom"; }\n`;
    await writeFile(join(cwd, "app/login/page.tsx"), editedLogin);
    await rm(join(cwd, "middleware.ts"));
    const check = new ManagedFilesCheck();
    expect((await check.run(ctxFor(cwd))).status).toBe("fail");

    await check.fix(ctxFor(cwd));

    expect((await check.run(ctxFor(cwd))).status).toBe("pass");
    expect(await readFile(join(cwd, "middleware.ts"), "utf8")).toContain(MANAGED_MARKER);
    expect(await readFile(join(cwd, "app/login/page.tsx"), "utf8")).toBe(editedLogin);
  });

  it("trusts the manifest over current templates", async () => {
    const cwd = await makeProject();
    const middleware = await readFile(join(cwd, "middleware.ts"), "utf8");
    await writeScaffoldState(cwd, {
      files: { "middleware.ts": { hash: hashScaffoldFile(middleware), class: "infrastructure" } },
    });
    // Deleting a file the manifest never recorded must not matter.
    await rm(join(cwd, "custom-elements.d.ts"));

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("pass");
    const details = outcome.details as ManagedDetails;
    expect(details.mode).toBe("manifest");
    expect(details.files).toHaveLength(1);
    expect(details.files[0]).toMatchObject({ path: "middleware.ts", state: "pristine" });
  });

  it("classifies edited files via the recorded hash", async () => {
    const cwd = await makeProject();
    await writeScaffoldState(cwd, {
      files: { "middleware.ts": { hash: "0".repeat(64), class: "infrastructure" } },
    });

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("pass");
    const details = outcome.details as ManagedDetails;
    expect(details.files[0]?.state).toBe("edited");
  });

  it("fails on missing manifest infrastructure; fix restores it and refreshes the hash", async () => {
    const cwd = await makeProject();
    await writeScaffoldState(cwd, {
      files: { "middleware.ts": { hash: "0".repeat(64), class: "infrastructure" } },
    });
    await rm(join(cwd, "middleware.ts"));
    const check = new ManagedFilesCheck();
    expect((await check.run(ctxFor(cwd))).status).toBe("fail");

    await check.fix(ctxFor(cwd));

    const outcome = await check.run(ctxFor(cwd));
    expect(outcome.status).toBe("pass");
    expect((outcome.details as ManagedDetails).files[0]?.state).toBe("pristine");
    const restored = await readFile(join(cwd, "middleware.ts"), "utf8");
    expect(restored).toContain(MANAGED_MARKER);
    expect((await readScaffoldState(cwd)).files["middleware.ts"]?.hash).toBe(
      hashScaffoldFile(restored),
    );
    // Without `scaffolded_framework` in the manifest, repair must not have
    // invented a framework home page.
    await expect(readFile(join(cwd, "app/page.tsx"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("fix never touches edited or adopted files", async () => {
    const cwd = await makeProject();
    const editedLogin = `${MANAGED_MARKER}\nexport default function L() { return "edited"; }\n`;
    const adoptedRegister = "export default function Own() {}\n";
    await writeFile(join(cwd, "app/login/page.tsx"), editedLogin);
    await writeFile(join(cwd, "app/register/page.tsx"), adoptedRegister);
    await writeScaffoldState(cwd, {
      files: {
        "middleware.ts": { hash: "0".repeat(64), class: "infrastructure" },
        "app/login/page.tsx": { hash: "1".repeat(64), class: "presentation" },
        "app/register/page.tsx": { hash: "2".repeat(64), class: "presentation" },
      },
    });
    await rm(join(cwd, "middleware.ts"));

    await new ManagedFilesCheck().fix(ctxFor(cwd));

    expect(await readFile(join(cwd, "app/login/page.tsx"), "utf8")).toBe(editedLogin);
    expect(await readFile(join(cwd, "app/register/page.tsx"), "utf8")).toBe(adoptedRegister);
    expect(await readFile(join(cwd, "middleware.ts"), "utf8")).toContain(MANAGED_MARKER);
  });

  it("fix previews without writing under dryRun", async () => {
    const cwd = await makeProject();
    await writeScaffoldState(cwd, {
      files: { "middleware.ts": { hash: "0".repeat(64), class: "infrastructure" } },
    });
    await rm(join(cwd, "middleware.ts"));

    await new ManagedFilesCheck().fix(ctxFor(cwd, true));

    await expect(readFile(join(cwd, "middleware.ts"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect((await readScaffoldState(cwd)).files["middleware.ts"]?.hash).toBe("0".repeat(64));
  });

  it("fix never re-pins an already-declared SDK dependency version", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "demo",
        dependencies: { next: "^15", "@zitadel/sdk-next": "user-pinned-0.0.1" },
      }),
    );
    await rm(join(cwd, "middleware.ts"));

    await new ManagedFilesCheck().fix(ctxFor(cwd));

    expect(await readFile(join(cwd, "middleware.ts"), "utf8")).toContain(MANAGED_MARKER);
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies["@zitadel/sdk-next"]).toBe("user-pinned-0.0.1");
  });

  it("degrades to template mode when a manifest entry is malformed", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, ".zitadel/state.json"),
      JSON.stringify({
        framework: "next",
        resources: {},
        scaffold: { files: { "middleware.ts": null } },
      }),
    );

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("pass");
    expect((outcome.details as ManagedDetails).mode).toBe("template");
  });

  it("template-mode fix materializes a manifest for pre-manifest apps", async () => {
    const cwd = await makeProject();
    // A pre-manifest app: state.json exists (sync resources) but has no
    // scaffold section. One page was adopted by the user; the boundary is
    // missing.
    await writeFile(
      join(cwd, ".zitadel/state.json"),
      JSON.stringify({ framework: "next", resources: {} }),
    );
    await writeFile(join(cwd, "app/register/page.tsx"), "export default function Own() {}\n");
    await rm(join(cwd, "middleware.ts"));
    const check = new ManagedFilesCheck();
    expect(((await check.run(ctxFor(cwd))).details as ManagedDetails).mode).toBe("template");

    await check.fix(ctxFor(cwd));

    const scaffold = await readScaffoldState(cwd);
    expect(scaffold.files["middleware.ts"]?.class).toBe("infrastructure");
    expect(scaffold.files["app/login/page.tsx"]?.class).toBe("presentation");
    // Adopted and conditionally-scaffolded files stay out of the manifest.
    expect(scaffold.files).not.toHaveProperty("app/register/page.tsx");
    expect(scaffold.files).not.toHaveProperty("app/page.tsx");
    const after = await check.run(ctxFor(cwd));
    expect(after.status).toBe("pass");
    expect((after.details as ManagedDetails).mode).toBe("manifest");
  });

  it("restores the framework home page when the manifest recorded a fresh scaffold", async () => {
    const cwd = await makeProject();
    await writeScaffoldState(cwd, {
      files: { "app/page.tsx": { hash: "0".repeat(64), class: "presentation" } },
      scaffolded_framework: true,
    });

    const check = new ManagedFilesCheck();
    expect((await check.run(ctxFor(cwd))).status).toBe("warn");

    await check.fix(ctxFor(cwd));

    expect((await check.run(ctxFor(cwd))).status).toBe("pass");
    expect(await readFile(join(cwd, "app/page.tsx"), "utf8")).toContain(MANAGED_MARKER);
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
    const ctx = await loadPatchContext(cwd, createOrca(), "0.1.0-alpha.0");

    expect(ctx.framework.id).toBe("next");
    expect(ctx.project.id).toBe("proj-001");
    expect(ctx.issuer).toBe("http://localhost:3000");
    expect(ctx.cliVersion).toBe("0.1.0-alpha.0");
    expect(ctx.preset).toBeUndefined();
    expect(ctx.scaffoldedFramework).toBeUndefined();
  });

  it("restores preset, use case, and scaffold facts", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({
        project: "proj-001",
        server: "https://api.zitadel.cloud",
        framework: { id: "next" },
        environments: { development: { issuer: "http://localhost:3000" } },
        preset: "passkey-first",
        useCase: "consumer",
      }),
    );
    await writeScaffoldState(cwd, { files: {}, scaffolded_framework: true, dev_port: 3005 });

    const ctx = await loadPatchContext(cwd, createOrca(), "0.1.0-alpha.0");

    expect(ctx.preset).toBe("passkey-first");
    expect(ctx.useCase).toBe("consumer");
    expect(ctx.scaffoldedFramework).toBe(true);
    // The config issuer still wins over the manifest port.
    expect(ctx.issuer).toBe("http://localhost:3000");
  });

  it("falls back to the manifest dev_port for the issuer", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({
        project: "proj-001",
        server: "https://api.zitadel.cloud",
        framework: { id: "next" },
      }),
    );
    await writeScaffoldState(cwd, { files: {}, dev_port: 3005 });

    const ctx = await loadPatchContext(cwd, createOrca(), "0.1.0-alpha.0");

    expect(ctx.issuer).toBe("http://localhost:3005");
  });
});

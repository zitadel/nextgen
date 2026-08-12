import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ClaimCheck,
  ConfigCheck,
  DependencyCheck,
  DependencyVersionCheck,
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
import { proxyConfTemplate } from "../../../../src/lib/orca/patchers/rule/angular/templates";
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

/**
 * A healthy Angular managed project with every config wiring applied:
 * `angular.json` carries the proxyConfig + port, the auth routes are in the
 * route table, and a `dev` script exists. The codex-review reproduction:
 * detaching only the angular.json wiring must fail doctor even though all
 * marked files are pristine.
 */
async function makeAngularProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-checks-ng-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel"), { recursive: true });
  await mkdir(join(cwd, "src/app"), { recursive: true });

  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({
      name: "demo",
      scripts: { dev: "ng serve" },
      dependencies: { "@angular/core": "^19.0.0", "@zitadel/sdk-angular": "latest" },
    }),
  );
  await writeFile(
    join(cwd, "zitadel.json"),
    JSON.stringify({
      project: "proj-001",
      server: "https://api.zitadel.cloud",
      framework: { id: "angular" },
      environments: { development: { issuer: "http://localhost:4200" } },
    }),
  );
  await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify(SECRET));
  await chmod(join(cwd, ".zitadel/secret"), 0o600);
  await writeFile(
    join(cwd, "angular.json"),
    JSON.stringify({
      projects: {
        demo: {
          architect: {
            serve: { options: { proxyConfig: "proxy.conf.cjs", port: 4200 } },
          },
        },
      },
    }),
  );
  await writeFile(
    join(cwd, "src/app/app.routes.ts"),
    [
      'import { Routes } from "@angular/router";',
      "",
      "export const routes: Routes = [",
      '  { path: "login", children: [] },',
      '  { path: "register", children: [] },',
      '  { path: "profile", children: [] },',
      "];",
      "",
    ].join("\n"),
  );
  await writeFile(join(cwd, "src/app/app.ts"), `${MANAGED_MARKER}\nexport class App {}\n`);
  await writeFile(join(cwd, "src/app/app.html"), `<!-- ${MANAGED_MARKER} -->\n<main></main>\n`);
  await writeFile(join(cwd, "proxy.conf.cjs"), proxyConfTemplate());
  return cwd;
}

/** Rewrites angular.json with the serve proxyConfig wiring removed. */
async function detachAngularProxy(cwd: string): Promise<void> {
  await writeFile(
    join(cwd, "angular.json"),
    JSON.stringify({
      projects: { demo: { architect: { serve: { options: { port: 4200 } } } } },
    }),
  );
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

  it("fails with the version floor when the app dropped below Next 15", async () => {
    // A scaffolded app later downgraded (or a pre-floor scaffold): doctor
    // must say why the integration is unsupported, not crash or pass.
    const cwd = await makeProject();
    const pkg = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    pkg.dependencies.next = "^14.2.0";
    await writeFile(join(cwd, "package.json"), JSON.stringify(pkg));
    const outcome = await new FrameworkCheck().run(ctxFor(cwd));
    expect(outcome.status).toBe("fail");
    expect(outcome.message).toContain("below the supported floor");
    // The typed error's category and remedy travel through the outcome so
    // the doctor envelope can surface them instead of generic --fix advice.
    expect(outcome.code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    expect(outcome.hint).toContain("Upgrade");
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

  it("fails when a managed config wiring is detached, and --fix re-applies it", async () => {
    const cwd = await makeAngularProject();
    const check = new ManagedFilesCheck();
    const healthy = await check.run(ctxFor(cwd));
    expect(healthy.status).toBe("pass");
    expect(healthy.message).toContain("wirings verified");

    // The codex repro: only the angular.json proxy wiring is removed — every
    // marked file stays pristine, yet auth requests are broken.
    await detachAngularProxy(cwd);
    const detached = await check.run(ctxFor(cwd));
    expect(detached.status).toBe("fail");
    expect(detached.message).toContain("detached managed config wiring: angular.json");

    await check.fix(ctxFor(cwd));

    const repaired = await check.run(ctxFor(cwd));
    expect(repaired.status).toBe("pass");
    const angularJson = JSON.parse(await readFile(join(cwd, "angular.json"), "utf8")) as {
      projects: { demo: { architect: { serve: { options: Record<string, unknown> } } } };
    };
    expect(angularJson.projects.demo.architect.serve.options.proxyConfig).toBe("proxy.conf.cjs");
  });

  it("fails when a wiring's host config file is deleted outright", async () => {
    const cwd = await makeAngularProject();
    await rm(join(cwd, "angular.json"));

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("fail");
    expect(outcome.message).toContain("detached managed config wiring: angular.json");
  });

  it("warns unverifiable when a wiring's config was restructured beyond the transform", async () => {
    const cwd = await makeAngularProject();
    // Two projects, no defaultProject: the transform throws rather than
    // guessing — the wiring state is unknown, which must surface, not vanish.
    await writeFile(
      join(cwd, "angular.json"),
      JSON.stringify({ projects: { a: {}, b: {} } }),
    );

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("warn");
    expect(outcome.message).toContain("unverifiable managed config wiring");
    expect(outcome.message).toContain("angular.json");
  });

  it("warns when an unrecognized legacy proxy may still over-forward the project secret", async () => {
    const cwd = await makeAngularProject();
    const proxyPath = join(cwd, "proxy.conf.cjs");
    const unsafe = (await readFile(proxyPath, "utf8")).replace(
      `/* zitadel:proxy:v2 */
function setBearer(proxyReq) {
  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
  if (
    proxyReq.method === "POST" &&
    pathname === "/sessions/exchange" &&
    !proxyReq.getHeader("authorization")
  ) {
    proxyReq.setHeader("authorization", bearer);
  }
}`,
      `function setBearer(proxyReq) {
  proxyReq
    .setHeader("authorization", bearer);
}`,
    );
    await writeFile(proxyPath, unsafe);

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("warn");
    expect(outcome.message).toContain("proxy.conf.cjs");
    expect(outcome.message).toContain(
      "may forward ZITADEL_PROJECT_SECRET outside POST /sessions/exchange",
    );
  });

  it("migrates a pristine retired boundary: --fix removes middleware.ts and installs proxy.ts", async () => {
    const cwd = await makeProject();
    const middleware = `${MANAGED_MARKER}\nexport function middleware() {}\n`;
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16", "@zitadel/sdk-next": "latest" } }),
    );
    await writeScaffoldState(cwd, {
      files: {
        "middleware.ts": { hash: hashScaffoldFile(middleware), class: "infrastructure" },
      },
    });
    const check = new ManagedFilesCheck();
    const before = await check.run(ctxFor(cwd));
    expect(before.status).toBe("warn");
    expect(before.message).toContain("retired boundary middleware.ts left over");

    await check.fix(ctxFor(cwd));

    // The pristine leftover is gone, the current boundary exists, and the
    // manifest swapped over — Next 16 would reject the pair.
    await expect(readFile(join(cwd, "middleware.ts"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(cwd, "proxy.ts"), "utf8")).toContain(MANAGED_MARKER);
    const scaffold = await readScaffoldState(cwd);
    expect(scaffold.files).not.toHaveProperty("middleware.ts");
    expect(scaffold.files["proxy.ts"]?.class).toBe("infrastructure");
    expect((await check.run(ctxFor(cwd))).status).toBe("pass");
  });

  it("refuses to create proxy.ts beside an edited middleware.ts and reports the conflict", async () => {
    const cwd = await makeProject();
    // The user upgraded to Next 16 but kept an edited middleware.ts; an
    // unrelated page is missing so --fix has repair work to do.
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16", "@zitadel/sdk-next": "latest" } }),
    );
    const editedMiddleware = `${MANAGED_MARKER}\nexport function middleware() { /* custom */ }\n`;
    await writeFile(join(cwd, "middleware.ts"), editedMiddleware);
    await writeScaffoldState(cwd, {
      files: {
        "middleware.ts": { hash: "0".repeat(64), class: "infrastructure" },
        "app/login/page.tsx": { hash: "1".repeat(64), class: "presentation" },
      },
    });
    await rm(join(cwd, "app/login/page.tsx"));
    const check = new ManagedFilesCheck();
    const before = await check.run(ctxFor(cwd));
    expect(before.status).toBe("fail");
    expect(before.message).toContain("conflicting request boundaries");
    expect(before.message).toContain("middleware.ts");

    await check.fix(ctxFor(cwd));

    // The unrelated page is restored; the conflicting boundary pair is NOT
    // created — Next throws when both exist — and the user file is untouched.
    expect(await readFile(join(cwd, "app/login/page.tsx"), "utf8")).toContain(MANAGED_MARKER);
    await expect(readFile(join(cwd, "proxy.ts"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(cwd, "middleware.ts"), "utf8")).toBe(editedMiddleware);
    expect((await check.run(ctxFor(cwd))).status).toBe("fail");
  });

  it("ignores a user-owned proxy.ts on Next 15 (not a reserved convention there)", async () => {
    const cwd = await makeProject();
    // The fixture is Next ^15 (boundary: middleware.ts). A root proxy.ts is
    // simply the user's file and must not trip the boundary-conflict logic.
    await writeFile(join(cwd, "proxy.ts"), "export function proxy() { /* user-owned */ }\n");

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("pass");
    expect(outcome.message).not.toContain("conflicting");
  });

  it("does not materialize a manifest while a boundary conflict is unresolved", async () => {
    const cwd = await makeProject();
    // Pre-manifest Next 15 app upgraded to 16 with an edited middleware.ts:
    // --fix must not finalize a manifest that records no boundary at all.
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16", "@zitadel/sdk-next": "latest" } }),
    );
    await writeFile(
      join(cwd, "middleware.ts"),
      `${MANAGED_MARKER}\nexport function middleware() { /* custom */ }\n`,
    );
    await writeFile(
      join(cwd, ".zitadel/state.json"),
      JSON.stringify({ framework: "next", resources: {} }),
    );
    const check = new ManagedFilesCheck();
    expect((await check.run(ctxFor(cwd))).status).toBe("fail");

    await check.fix(ctxFor(cwd));

    // No proxy.ts, no manifest: the app stays on the template fallback,
    // which keeps demanding the boundary — deleting middleware.ts later
    // still fails instead of passing against an empty manifest.
    await expect(readFile(join(cwd, "proxy.ts"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    const state = JSON.parse(await readFile(join(cwd, ".zitadel/state.json"), "utf8")) as {
      scaffold?: unknown;
    };
    expect(state.scaffold).toBeUndefined();
    expect((await check.run(ctxFor(cwd))).status).toBe("fail");

    // The user resolves the conflict properly (migrates their edits): the
    // next --fix materializes a manifest that records the boundary.
    await rm(join(cwd, "middleware.ts"));
    await writeFile(join(cwd, "proxy.ts"), `${MANAGED_MARKER}\nexport function proxy() {}\n`);
    await check.fix(ctxFor(cwd));
    const scaffold = await readScaffoldState(cwd);
    expect(scaffold.files["proxy.ts"]?.class).toBe("infrastructure");
    expect((await check.run(ctxFor(cwd))).status).toBe("pass");
  });

  it("stays on the template fallback when an infrastructure file was adopted", async () => {
    const cwd = await makeProject();
    // The user replaced the boundary with their own marker-less file; a
    // materialized manifest could not track it, so none is written and the
    // presence-enforcing fallback stays in charge.
    await writeFile(join(cwd, "middleware.ts"), "export function middleware() {}\n");
    await writeFile(
      join(cwd, ".zitadel/state.json"),
      JSON.stringify({ framework: "next", resources: {} }),
    );
    const check = new ManagedFilesCheck();
    expect((await check.run(ctxFor(cwd))).status).toBe("pass");

    await check.fix(ctxFor(cwd));

    const state = JSON.parse(await readFile(join(cwd, ".zitadel/state.json"), "utf8")) as {
      scaffold?: unknown;
    };
    expect(state.scaffold).toBeUndefined();
    expect((await check.run(ctxFor(cwd))).status).toBe("pass");
  });

  it("warns (not fails) when only the convenience dev script is missing", async () => {
    const cwd = await makeAngularProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "demo",
        dependencies: { "@angular/core": "^19.0.0", "@zitadel/sdk-angular": "latest" },
      }),
    );

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("warn");
    expect(outcome.message).toContain("unapplied managed config edit(s): package.json");
  });

  it("degrades to template mode when the manifest files record is an array", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, ".zitadel/state.json"),
      JSON.stringify({ framework: "next", resources: {}, scaffold: { files: [] } }),
    );

    const outcome = await new ManagedFilesCheck().run(ctxFor(cwd));

    expect(outcome.status).toBe("pass");
    expect((outcome.details as ManagedDetails).mode).toBe("template");
    expect((outcome.details as ManagedDetails).files.length).toBeGreaterThan(0);
  });

  it("reconciles retired boundary paths across a Next 15 to 16 upgrade", async () => {
    const cwd = await makeProject();
    // The app was scaffolded on Next 15 (manifest demands middleware.ts),
    // then upgraded to Next 16 — the current templates write proxy.ts.
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({ name: "demo", dependencies: { next: "^16", "@zitadel/sdk-next": "latest" } }),
    );
    await writeScaffoldState(cwd, {
      files: { "middleware.ts": { hash: "0".repeat(64), class: "infrastructure" } },
    });
    await rm(join(cwd, "middleware.ts"));
    const check = new ManagedFilesCheck();
    expect((await check.run(ctxFor(cwd))).status).toBe("fail");

    await check.fix(ctxFor(cwd));

    // Repair restored the *current* boundary and the manifest converged on
    // it: the retired middleware.ts entry is gone, so doctor passes instead
    // of failing forever (setup skips initialized projects).
    expect(await readFile(join(cwd, "proxy.ts"), "utf8")).toContain(MANAGED_MARKER);
    const scaffold = await readScaffoldState(cwd);
    expect(scaffold.files).not.toHaveProperty("middleware.ts");
    expect(scaffold.files["proxy.ts"]?.class).toBe("infrastructure");
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

describe("ClaimCheck", () => {
  /** Rewrites `.zitadel/secret`, preserving the 0600 mode doctor asserts elsewhere. */
  async function writeSecret(cwd: string, extra: Record<string, unknown>): Promise<void> {
    await writeFile(join(cwd, ".zitadel/secret"), JSON.stringify({ ...SECRET, ...extra }));
    await chmod(join(cwd, ".zitadel/secret"), 0o600);
  }

  /** Rewrites `zitadel.json` with a different `server`, leaving everything else intact. */
  async function writeServer(cwd: string, server: string): Promise<void> {
    const config = JSON.parse(await readFile(join(cwd, "zitadel.json"), "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(join(cwd, "zitadel.json"), JSON.stringify({ ...config, server }));
  }

  it("warns for a cloud project with no owning team", async () => {
    const cwd = await makeProject();
    const outcome = await new ClaimCheck().run(ctxFor(cwd));
    expect(outcome.status).toBe("warn");
    expect(outcome.message).toContain("temporary until you attach it to a team");
  });

  it("passes and names the team once attached", async () => {
    const cwd = await makeProject();
    await writeSecret(cwd, { claimed_at: "2026-01-02T00:00:00.000Z", team_id: "team-001" });
    const outcome = await new ClaimCheck().run(ctxFor(cwd));
    expect(outcome.status).toBe("pass");
    expect(outcome.message).toContain("team-001");
  });

  // Local and self-hosted servers have no platform team, so there is nothing to
  // nudge toward and a warning would be permanent noise.
  it("passes without a nudge off the cloud", async () => {
    for (const server of ["http://localhost:8080", "https://zitadel.example.com"]) {
      const cwd = await makeProject();
      await writeServer(cwd, server);
      const outcome = await new ClaimCheck().run(ctxFor(cwd));
      expect(outcome.status).toBe("pass");
      expect(outcome.message).not.toContain("temporary");
    }
  });

  // Nothing wraps a throw from this check (it implements SanityCheck directly),
  // so an unreadable secret must not take the whole battery down with it — the
  // `secret` check is the one that reports that problem.
  it("skips instead of throwing when the secret cannot be read", async () => {
    const cwd = await makeProject();
    await rm(join(cwd, ".zitadel/secret"));
    const outcome = await new ClaimCheck().run(ctxFor(cwd));
    expect(outcome.status).toBe("pass");
    expect(outcome.message).toContain("Skipped");
  });

  // `doctor --fix` calls fix() on every non-passing check. Claiming needs a
  // browser, so this one must be inert rather than half-writing the record.
  it("has no automatic repair", async () => {
    const cwd = await makeProject();
    const before = await readFile(join(cwd, ".zitadel/secret"), "utf8");
    await new ClaimCheck().fix(ctxFor(cwd));
    expect(await readFile(join(cwd, ".zitadel/secret"), "utf8")).toBe(before);
    expect((await new ClaimCheck().run(ctxFor(cwd))).status).toBe("warn");
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

  it("restores the recorded posture, defaulting absence to page (ADR 044)", async () => {
    const cwd = await makeProject();
    await writeScaffoldState(cwd, { files: {}, posture: "widget" });
    expect((await loadPatchContext(cwd, createOrca(), "0.1.0-alpha.0")).posture).toBe("widget");

    // No record (legacy manifest, or none at all) restores full-page — the
    // only posture that existed before the record.
    await writeScaffoldState(cwd, { files: {} });
    expect((await loadPatchContext(cwd, createOrca(), "0.1.0-alpha.0")).posture).toBe("page");
  });

  it("degrades an unknown posture value to template mode, restoring page", async () => {
    const cwd = await makeProject();
    await writeScaffoldState(cwd, {
      files: {},
      posture: "split",
    } as unknown as ScaffoldManifest);
    // A future-shaped manifest is rejected wholesale (readScaffoldManifest
    // returns undefined), so the context falls back to the page posture.
    expect((await loadPatchContext(cwd, createOrca(), "0.1.0-alpha.0")).posture).toBe("page");
  });
});

describe("DependencyVersionCheck", () => {
  it("passes when exact Zitadel pins match the CLI version", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "demo",
        dependencies: { next: "^15", "@zitadel/sdk-next": "0.1.0-alpha.18" },
      }),
    );
    const outcome = await new DependencyVersionCheck().run({
      ...ctxFor(cwd),
      cliVersion: "0.1.0-alpha.18",
    });
    expect(outcome.status).toBe("pass");
    expect(outcome.message).toContain("1 compared");
  });

  it("warns with the exact remedy when a pin trails the CLI train", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "demo",
        dependencies: { "@zitadel/sdk-next": "0.1.0-alpha.17" },
        devDependencies: { "@zitadel/testing": "0.1.0-alpha.17" },
      }),
    );
    const outcome = await new DependencyVersionCheck().run({
      ...ctxFor(cwd),
      cliVersion: "0.1.0-alpha.18",
    });
    expect(outcome.status).toBe("warn");
    expect(outcome.message).toContain("@zitadel/sdk-next@0.1.0-alpha.17");
    // No lockfile or packageManager field in the fixture, so npm is the
    // detected fallback; the remedy must pin exactly, not caret-float.
    const remedy =
      "npm install --save-exact @zitadel/sdk-next@0.1.0-alpha.18 @zitadel/testing@0.1.0-alpha.18";
    expect(outcome.message).toContain(remedy);
    expect(outcome.details).toEqual({
      mismatched: [
        { name: "@zitadel/sdk-next", declared: "0.1.0-alpha.17", expected: "0.1.0-alpha.18" },
        { name: "@zitadel/testing", declared: "0.1.0-alpha.17", expected: "0.1.0-alpha.18" },
      ],
      remedy_command: remedy,
    });
  });

  it("writes the remedy with the project's own package manager", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "demo",
        dependencies: { "@zitadel/sdk-next": "0.1.0-alpha.17" },
      }),
    );
    await writeFile(join(cwd, "pnpm-lock.yaml"), "");
    const outcome = await new DependencyVersionCheck().run({
      ...ctxFor(cwd),
      cliVersion: "0.1.0-alpha.18",
    });
    expect(outcome.status).toBe("warn");
    // A bare `npm install` on a pnpm project would switch package managers.
    expect(outcome.message).toContain("pnpm add --save-exact @zitadel/sdk-next@0.1.0-alpha.18");
    expect((outcome.details as { remedy_command?: string }).remedy_command).toBe(
      "pnpm add --save-exact @zitadel/sdk-next@0.1.0-alpha.18",
    );
  });

  it("ignores ranges, dist-tags, and file specifiers", async () => {
    const cwd = await makeProject();
    await writeFile(
      join(cwd, "package.json"),
      JSON.stringify({
        name: "demo",
        dependencies: {
          "@zitadel/sdk-next": "latest",
          "@zitadel/components": "^0.1.0-alpha.2",
          "@zitadel/api": "file:../local.tgz",
        },
      }),
    );
    const outcome = await new DependencyVersionCheck().run({
      ...ctxFor(cwd),
      cliVersion: "0.1.0-alpha.18",
    });
    expect(outcome.status).toBe("pass");
    expect(outcome.message).toContain("no exactly-pinned");
  });

  it("skips the comparison for non-release CLI versions", async () => {
    const cwd = await makeProject();
    const outcome = await new DependencyVersionCheck().run({
      ...ctxFor(cwd),
      cliVersion: "workspace-dev",
    });
    expect(outcome.status).toBe("pass");
    expect(outcome.message).toContain("not an exact release");
  });

  it("passes quietly when package.json is missing", async () => {
    const cwd = await makeProject();
    await rm(join(cwd, "package.json"));
    const outcome = await new DependencyVersionCheck().run({
      ...ctxFor(cwd),
      cliVersion: "0.1.0-alpha.18",
    });
    // The dependency check owns that failure; this one only compares pins.
    expect(outcome.status).toBe("pass");
  });
});

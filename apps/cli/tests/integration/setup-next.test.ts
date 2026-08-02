import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  resetPlatformStore,
  setupPlatformHandlers,
  snapshotPlatformStore,
} from "@zitadel/api-mock/platform";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../helpers/run-cli";

const MOCK_SERVER_URL = "http://mock.zitadel.test";

const server = setupServer(...setupPlatformHandlers());

beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterAll(() => server.close());
afterEach(() => {
  server.resetHandlers();
  resetPlatformStore();
});

function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  return runCliForTest([...args, "--server", MOCK_SERVER_URL], env);
}

describe("Next setup integration", () => {
  it("sets up, verifies, plans, applies, and preserves idempotency", async () => {
    const cwd = await createNextProject();
    const fakeNpm = await fakePackageManager("npm");

    const setup = await cli(["setup", "--cwd", cwd, "--non-interactive", "--json"], {
      PACKAGE_MANAGER_LOG: fakeNpm.logPath,
      PATH: `${fakeNpm.binDir}:${process.env.PATH ?? ""}`,
    });
    expect(setup.exitCode).toBe(0);
    const setupJson = parseJson(setup.stdout) as {
      status: string;
      data: {
        install: { status: string; package_manager: string; command: string };
        files_written: string[];
        files: Array<{ path: string; kind: string; action: string }>;
        next_actions: string[];
        next_commands: string[];
      };
    };
    expect(setupJson.status).toBe("ok");
    expect(setup.stdout).not.toContain("fake npm stdout");
    expect(setup.stderr).toContain("fake npm stdout");
    expect(setup.stderr).toContain("fake npm stderr");
    expect(setupJson.data.install).toMatchObject({
      status: "completed",
      package_manager: "npm",
      command: "npm install",
    });
    expect(setupJson.data.next_commands[0]).toBe("npm run dev");
    expect(setupJson.data.next_commands[1]).toMatch(/^npx @zitadel\/cli@\S+ plan$/);
    expect(setupJson.data.next_actions.join("\n")).toContain("register a user");
    expect(setupJson.data.next_actions.join("\n")).toContain("log in again");
    expect(setupJson.data.next_actions.join("\n")).toContain("/profile shows Signed in");
    expect(setupJson.data.next_actions.join("\n")).toContain(".zitadel/schemas/");
    expect(setupJson.data.next_actions.join("\n")).toContain(".zitadel/flows/");
    expect(setupJson.data.next_actions.join("\n")).toContain("See your changes before they go live");
    expect(setupJson.data.files_written).toContain(".zitadel/schemas/default-human-user.json");
    expect(setupJson.data.files_written).toContain(".zitadel/flows/default-login.json");
    // files_written carries deduplicated file paths only: no directories,
    // and a path touched by several plan ops (both env files are) once.
    expect(new Set(setupJson.data.files_written).size).toBe(setupJson.data.files_written.length);
    expect(setupJson.data.files_written).not.toContain(".zitadel");
    expect(setupJson.data.files_written.filter((path) => path === ".env.local")).toHaveLength(1);
    // The typed rows label each scaffolded artifact with kind and action;
    // the fixture is a pre-existing app, so its package.json is an update
    // while the boundary is a create.
    expect(setupJson.data.files).toContainEqual({
      path: "proxy.ts",
      kind: "file",
      action: "create",
    });
    expect(setupJson.data.files).toContainEqual({
      path: "package.json",
      kind: "file",
      action: "update",
    });
    expect(setupJson.data.files).toContainEqual({
      path: ".zitadel",
      kind: "dir",
      action: "create",
    });
    // package.json stays the user's file: top-level key order and formatting
    // survive the dependency splice (the fixture starts with name/private).
    const pkgText = await readFile(join(cwd, "package.json"), "utf8");
    expect(Object.keys(JSON.parse(pkgText) as Record<string, unknown>).slice(0, 2)).toEqual([
      "name",
      "private",
    ]);

    // Scaffolded guidance: AGENTS.md for agents, a README section for
    // humans, and the dialect meta-schemas the flow files' $schema points at.
    const agentsMd = await readFile(join(cwd, "AGENTS.md"), "utf8");
    expect(agentsMd).toContain("## Authentication (Zitadel)");
    expect(agentsMd).toContain("not 127.0.0.1");
    expect(agentsMd).toContain('"$schema": "../meta/flow-definition.json"');
    const readme = await readFile(join(cwd, "README.md"), "utf8");
    expect(readme).toContain("## Authentication (Zitadel)");
    const metaSchema = JSON.parse(
      await readFile(join(cwd, ".zitadel/meta/flow-definition.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(metaSchema.title).toBe("FlowDefinition");
    const installLog = JSON.parse((await readFile(fakeNpm.logPath, "utf8")).trim()) as {
      cwd: string;
      args: string[];
    };
    expect(installLog).toEqual({ cwd: await realpath(cwd), args: ["install"] });

    // Setup scaffolds the default schema and flow locally, uploads those files
    // through the resource APIs, and seeds sync state with the returned
    // ids/hashes, so `plan` is immediately empty.
    expect(await readFile(join(cwd, "zitadel.json"), "utf8")).toContain('"project"');
    const schema = JSON.parse(
      await readFile(join(cwd, ".zitadel/schemas/default-human-user.json"), "utf8"),
    ) as {
      objectType: string;
      kind: string;
      properties: Record<string, unknown>;
    };
    expect(schema.kind).toBe("user-schema");
    expect(schema.objectType).toBe("human-user");
    expect(schema).not.toHaveProperty("$id");
    expect(schema.properties).toHaveProperty("email");
    // The schema id is server-assigned on create; the local file stays
    // id-less and the flow pins whatever id came back.
    const state = JSON.parse(await readFile(join(cwd, ".zitadel/state.json"), "utf8")) as {
      resources: Record<string, { id?: string; hash?: string; name?: string; status?: string }>;
    };
    const schemaId = state.resources[".zitadel/schemas/default-human-user.json"]?.id;
    expect(schemaId).toMatch(/^sch_/);
    const flow = JSON.parse(
      await readFile(join(cwd, ".zitadel/flows/default-login.json"), "utf8"),
    ) as {
      name: string;
      status: string;
      user_schema: string;
      purposes: Record<string, string>;
    };
    expect(flow.name).toBe("default-login");
    expect(flow.status).toBe("active");
    expect(flow.user_schema).toBe(schemaId);
    // The editor pointer survives the upload/write-back round-trip: the
    // server ignores it and sync treats it as noise, so it stays on disk.
    expect((flow as { $schema?: string }).$schema).toBe("../meta/flow-definition.json");
    expect(flow.purposes).toMatchObject({ login: "identifier", register: "register" });
    expect(snapshotPlatformStore()).toMatchObject({
      projects: 1,
      schemas: 1,
      flowDefinitions: 1,
      schemaIds: [schemaId],
    });
    expect(state.resources[".zitadel/schemas/default-human-user.json"]).toMatchObject({
      id: schemaId,
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    // Setup also records the scaffold manifest: exactly the app files it
    // wrote, with content hashes and ownership classes, so `doctor` can later
    // tell missing from edited from user-adopted. This fixture is a
    // pre-existing app, so the framework home page is absent from the record.
    const scaffold = (
      state as unknown as {
        scaffold: {
          files: Record<string, { hash: string; class: string }>;
          scaffolded_framework?: boolean;
        };
      }
    ).scaffold;
    // The fixture declares next ^16, so the boundary is proxy.ts.
    expect(scaffold.files["proxy.ts"]).toMatchObject({
      class: "infrastructure",
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(scaffold.files["custom-elements.d.ts"]?.class).toBe("infrastructure");
    expect(scaffold.files["app/login/page.tsx"]?.class).toBe("presentation");
    expect(scaffold.files).not.toHaveProperty("app/page.tsx");
    expect(scaffold.scaffolded_framework).toBeUndefined();
    expect(state.resources[".zitadel/flows/default-login.json"]).toMatchObject({
      id: expect.stringMatching(/^flow_/),
      hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      name: "default-login",
      status: "active",
    });
    const loginPage = await readFile(join(cwd, "app/login/page.tsx"), "utf8");
    expect(loginPage).toContain("zitadel-cli: managed-file v1");
    expect(loginPage).toContain('"use client"');
    expect(loginPage).toContain('purpose="login"');
    expect(loginPage).toContain("<zitadel-login");
    // The SDK handle is built (proxy path + project id from the public env
    // var) and passed to the component via the `project` prop; the backend URL
    // stays server-side.
    expect(loginPage).toContain("configureZitadel");
    expect(loginPage).toContain('proxyPath: "/__nextgen"');
    expect(loginPage).toContain("project={project}");
    expect(loginPage).not.toContain("NEXT_PUBLIC_ZITADEL_API_BASE");
    expect(loginPage).toContain('post-sign-in-url="/profile"');
    expect(loginPage).not.toContain('href="/register"');
    expect(loginPage).not.toContain("next/link");
    expect(loginPage).not.toContain('href="/profile"');
    // The default (minimal) use case keeps the widget's neutral built-in copy.
    expect(loginPage).not.toContain("businessLocales");
    const registerPage = await readFile(join(cwd, "app/register/page.tsx"), "utf8");
    expect(registerPage).toContain('purpose="register"');
    expect(registerPage).not.toContain('href="/login"');
    expect(registerPage).not.toContain('href="/profile"');
    const profilePage = await readFile(join(cwd, "app/profile/page.tsx"), "utf8");
    expect(profilePage).toContain("zitadel-cli: managed-file v1");
    expect(profilePage).toContain("<zitadel-session");
    // The session card is widget-first; the dedicated /profile route must opt
    // into the full-page surface explicitly.
    expect(profilePage).toContain('variant="page"');
    expect(profilePage).toContain("configureZitadel");
    expect(profilePage).toContain("project={project}");
    expect(profilePage).toContain('post-sign-out-url="/login"');
    const customElements = await readFile(join(cwd, "custom-elements.d.ts"), "utf8");
    // The JSX declarations ship with the SDK — the scaffold references them
    // instead of carrying a hand-maintained copy that drifts.
    expect(customElements).toContain('/// <reference types="@zitadel/sdk-next/jsx" />');
    const proxy = await readFile(join(cwd, "proxy.ts"), "utf8");
    expect(proxy).toContain("zitadel-cli: managed-file v1");
    expect(proxy).toContain("nextgenMiddleware");
    expect(proxy).toContain("export function proxy(");
    expect(proxy).toContain('protectedRoutes: ["/profile"]');
    expect(proxy).toContain('"/__nextgen/:path*"');
    expect(proxy).toContain("process.env.ZITADEL_URL");
    const envLocal = await readFile(join(cwd, ".env.local"), "utf8");
    expect(envLocal).toContain("ZITADEL_ENVIRONMENT=development");
    expect(envLocal).toContain("ZITADEL_URL=");
    expect(envLocal).not.toContain("NEXT_PUBLIC_ZITADEL_API_BASE");
    expect(envLocal).toContain("NEXT_PUBLIC_ZITADEL_PROJECT_ID=");
    // The dev proxy/middleware sends the project service-key secret as the
    // bearer; the SPA framework patchers read it from .env.local server-side.
    // .env.local is gitignored, so the secret never leaves the machine.
    expect(envLocal).toContain("ZITADEL_PROJECT_SECRET=");
    expect(envLocal).not.toContain("ZITADEL_PREVIEW_SECRET");
    expect((await stat(join(cwd, ".zitadel/secret"))).mode & 0o777).toBe(0o600);
    const packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(packageJson.dependencies?.["@zitadel/sdk-next"]).toBe(await expectedCliVersion());

    const fake = await fakeDocker();
    const port = await freePort();
    const doctor = await cli(["doctor", "--cwd", cwd, "--json", "--port", String(port)], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });
    expect(doctor.exitCode).toBe(0);
    expect((parseJson(doctor.stdout) as { status: string }).status).toBe("ok");

    const noArg = await cli(["status", "--cwd", cwd, "--json"]);
    expect(noArg.exitCode).toBe(0);
    const status = parseJson(noArg.stdout) as {
      status: string;
      data: { next_actions: string[]; next_commands: string[] };
    };
    expect(status.status).toBe("ok");
    // The project exists but nobody has registered yet, so status stages BOTH
    // channels to the verify mission: next_actions carries the browser proof,
    // next_commands previews with plan and withholds apply until users exist.
    expect(status.data.next_commands.join(" ")).toContain("plan");
    expect(status.data.next_commands.join(" ")).not.toContain("apply");
    expect(status.data.next_actions.join("\n")).toContain("register a user");
    expect(status.data.next_actions.join("\n")).not.toContain(".zitadel/schemas/");

    const rerun = await cli(["setup", "--cwd", cwd, "--json"]);
    expect(rerun.exitCode).toBe(0);
    expect((parseJson(rerun.stdout) as { status: string }).status).toBe("skipped");

    const stateBeforePlan = await readFile(join(cwd, ".zitadel/state.json"), "utf8");
    const plan = await cli(["plan", "--cwd", cwd, "--json"]);
    expect(plan.exitCode).toBe(0);
    const planJson = parseJson(plan.stdout) as {
      status: string;
      data: { creates: number; updates: number; deletes: number; total: number };
    };
    expect(planJson.status).toBe("ok");
    expect(planJson.data).toMatchObject({ creates: 0, updates: 0, deletes: 0, total: 0 });
    expect(await readFile(join(cwd, ".zitadel/state.json"), "utf8")).toBe(stateBeforePlan);

    const apply = await cli(["apply", "--cwd", cwd, "--json"]);
    expect(apply.exitCode).toBe(0);
    const applyJson = parseJson(apply.stdout) as { status: string; data: { synced: boolean } };
    expect(applyJson.status).toBe("ok");
    expect(applyJson.data.synced).toBe(true);

    // Noise regression guard: a one-field schema edit must render as exactly
    // that. Server-echoed fields (`audience: {}` on flows, spelled-out x-*
    // meta-schema defaults) must never surface as changes the user didn't make.
    const editedSchemaPath = join(cwd, ".zitadel/schemas/default-human-user.json");
    const editedSchema = JSON.parse(await readFile(editedSchemaPath, "utf8")) as {
      properties: Record<string, unknown>;
    };
    editedSchema.properties.company = { type: "string", description: "Company name" };
    await writeFile(editedSchemaPath, `${JSON.stringify(editedSchema, null, 2)}\n`);

    const planAfterEdit = await cli(["plan", "--cwd", cwd]);
    expect(planAfterEdit.exitCode).toBe(0);
    const planOutput = `${planAfterEdit.stdout}\n${planAfterEdit.stderr}`;
    expect(planOutput).toContain("company");
    expect(planOutput).toContain("will publish a new revision");
    expect(planOutput).toContain("user_schema will be re-pinned to the new revision");
    expect(planOutput).not.toContain("audience");
    expect(planOutput).not.toContain("x-editable");

    // The Elina journey: use the new field in the register step and publish
    // schema + flow in ONE apply — the CLI re-pins user_schema to the freshly
    // minted revision id so the flow update validates against it.
    const editedFlowPath = join(cwd, ".zitadel/flows/default-login.json");
    const editedFlow = JSON.parse(await readFile(editedFlowPath, "utf8")) as {
      user_schema: string;
      steps: Array<{ name: string; fields?: string[] }>;
    };
    const registerStep = editedFlow.steps.find((step) => step.name === "register");
    registerStep?.fields?.push("company");
    await writeFile(editedFlowPath, `${JSON.stringify(editedFlow, null, 2)}\n`);

    const singleApply = await cli(["apply", "--cwd", cwd, "--json"]);
    expect(singleApply.exitCode).toBe(0);
    const singleApplyJson = parseJson(singleApply.stdout) as {
      status: string;
      data: { synced: boolean; files_updated: string[] };
    };
    expect(singleApplyJson.status).toBe("ok");
    expect(singleApplyJson.data.files_updated).toContain(".zitadel/flows/default-login.json");

    const stateAfter = JSON.parse(await readFile(join(cwd, ".zitadel/state.json"), "utf8")) as {
      resources: Record<string, { id?: string; previousId?: string }>;
    };
    const newSchemaId = stateAfter.resources[".zitadel/schemas/default-human-user.json"]?.id;
    expect(newSchemaId).toMatch(/^sch_/);
    expect(newSchemaId).not.toBe(schemaId);
    const repinnedFlow = JSON.parse(await readFile(editedFlowPath, "utf8")) as {
      user_schema: string;
      steps: Array<{ name: string; fields?: string[] }>;
    };
    expect(repinnedFlow.user_schema).toBe(newSchemaId);
    expect(repinnedFlow.steps.find((s) => s.name === "register")?.fields).toContain("company");

    const planAfterApply = await cli(["plan", "--cwd", cwd, "--json"]);
    expect(planAfterApply.exitCode).toBe(0);
    expect((parseJson(planAfterApply.stdout) as { data: { total: number } }).data.total).toBe(0);
  });

  it("refuses setup below the Next 15 floor with an explicit error", async () => {
    const cwd = await createNextProject("^14.2.0");
    const setup = await cli(["setup", "--cwd", cwd, "--non-interactive", "--json", "--skip-install"]);
    // ADR 043: unsupported versions are a loud gate, never a silent
    // narrowing — the envelope carries the machine code and the floor.
    expect(setup.exitCode).toBe(3);
    const envelope = parseJson(setup.stdout) as { status: string; code: string; message: string };
    expect(envelope.status).toBe("error");
    expect(envelope.code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    expect(envelope.message).toContain("below the supported floor");
    // The gate fires at detection, before any project or file mutation.
    await expect(stat(join(cwd, "zitadel.json"))).rejects.toThrow();
  });

  it("reports the floor through the doctor envelope on a downgraded app", async () => {
    // Scaffold healthy, then downgrade next below the floor — the ADR 043
    // story doctor must tell truthfully: the advertised machine code and the
    // upgrade hint, not a generic validation error recommending --fix (which
    // cannot repair an unsupported version).
    const cwd = await createNextProject();
    const setup = await cli(["setup", "--cwd", cwd, "--non-interactive", "--json", "--skip-install"]);
    expect(setup.exitCode).toBe(0);
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      dependencies: Record<string, string>;
    };
    pkg.dependencies.next = "^14.2.0";
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

    const fake = await fakeDocker();
    const port = await freePort();
    const doctor = await cli(["doctor", "--cwd", cwd, "--json", "--port", String(port)], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });
    expect(doctor.exitCode).toBe(3);
    const envelope = parseJson(doctor.stdout) as {
      code: string;
      hint?: string;
      next_commands?: string[];
    };
    expect(envelope.code).toBe("E_UNSUPPORTED_PROJECT_SHAPE");
    expect(envelope.hint).toContain("Upgrade the app to Next 15+");
    expect((envelope.next_commands ?? []).join(" ")).not.toContain("--fix");
  });

  it("skips rerun setup without rewriting edited schema or flow config", async () => {
    const cwd = await createNextProject();
    const setup = await cli(["setup", "--cwd", cwd, "--non-interactive", "--json", "--skip-install"]);
    expect(setup.exitCode).toBe(0);

    const flowPath = join(cwd, ".zitadel/flows/default-login.json");
    const schemaPath = join(cwd, ".zitadel/schemas/default-human-user.json");
    const editedFlow = `${await readFile(flowPath, "utf8")}\n`;
    const editedSchema = `${await readFile(schemaPath, "utf8")}\n`;
    await writeFile(flowPath, editedFlow);
    await writeFile(schemaPath, editedSchema);

    const rerun = await cli(["setup", "--cwd", cwd, "--non-interactive", "--json", "--skip-install"]);
    expect(rerun.exitCode).toBe(0);
    expect((parseJson(rerun.stdout) as { status: string }).status).toBe("skipped");
    await expect(readFile(flowPath, "utf8")).resolves.toBe(editedFlow);
    await expect(readFile(schemaPath, "utf8")).resolves.toBe(editedSchema);
  });

  it("releases the already-initialized marker when resource seeding fails so a rerun can complete", async () => {
    const cwd = await createNextProject();
    // First attempt: the platform rejects the schema upload after the
    // project was already created and zitadel.json was written.
    server.use(
      http.post("*/schemas", () =>
        HttpResponse.json({ code: "internal", message: "boom" }, { status: 500 }),
      ),
    );

    const failed = await cli(["setup", "--cwd", cwd, "--non-interactive", "--json", "--skip-install"]);
    expect(failed.exitCode).not.toBe(0);
    expect((parseJson(failed.stdout) as { status: string }).status).toBe("error");
    // The skip marker must be gone — otherwise every rerun reports
    // "skipped" and the project is stranded without a login flow.
    await expect(stat(join(cwd, "zitadel.json"))).rejects.toThrow();

    // Rerun against a healthy platform completes the interrupted setup.
    server.resetHandlers();
    const retry = await cli([
      "setup",
      "--cwd",
      cwd,
      "--non-interactive",
      "--json",
      "--skip-install",
      "--force",
    ]);
    expect(retry.exitCode).toBe(0);
    expect((parseJson(retry.stdout) as { status: string }).status).toBe("ok");
    const state = JSON.parse(await readFile(join(cwd, ".zitadel/state.json"), "utf8")) as {
      resources: Record<string, { id?: string }>;
    };
    expect(state.resources[".zitadel/schemas/default-human-user.json"]?.id).toMatch(/^sch_/);
    expect(state.resources[".zitadel/flows/default-login.json"]?.id).toMatch(/^flow_/);
  });

  it("fails apply clearly for missing env refs", async () => {
    const cwd = await createNextProject();
    await cli(["setup", "--cwd", cwd, "--non-interactive", "--json", "--skip-install"]);

    const flowWithEnvRef = {
      // Spec: `name` is the slug-pattern stable identifier; required fields
      // are [name, status, user_schema, purposes, steps]. `purposes` is a map
      // from purpose name to entry-point step name.
      name: "default",
      status: "active",
      user_schema:
        "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml",
      purposes: { login: "identifier" },
      steps: [
        {
          name: "identifier",
          fields: [],
          actions: [{ name: "submit", kind: "submit", primary: true }],
          transitions: { submit: { target: "done" } },
          gates: {
            captcha: {
              kind: "captcha",
              provider: "altcha",
              config: { client_secret_env: "MY_CAPTCHA_SECRET" },
            },
          },
        },
        { name: "done", complete: "show" },
      ],
    };
    await writeFile(
      join(cwd, ".zitadel/flows/default.json"),
      JSON.stringify(flowWithEnvRef, null, 2),
    );

    const apply = await cli(["apply", "--cwd", cwd, "--json"]);
    expect(apply.exitCode).toBe(3);
    const applyJson = parseJson(apply.stdout) as { code: string; message: string };
    expect(applyJson.code).toBe("E_VALIDATION");
    expect(applyJson.message).toContain("Missing environment variables");

    const applyWithEnv = await cli(["apply", "--cwd", cwd, "--json"], {
      MY_CAPTCHA_SECRET: "hunter2",
    });
    expect(applyWithEnv.exitCode).toBe(0);
  });

  it("scaffolds the passkey-first preset with a clean first plan", async () => {
    const cwd = await createNextProject();
    const fakeNpm = await fakePackageManager("npm");
    const setup = await cli(
      ["setup", "--cwd", cwd, "--preset", "passkey-first", "--non-interactive", "--json"],
      {
        PACKAGE_MANAGER_LOG: fakeNpm.logPath,
        PATH: `${fakeNpm.binDir}:${process.env.PATH ?? ""}`,
      },
    );
    expect(setup.exitCode).toBe(0);

    // The preset decides the scaffolded journey: login enters on a
    // fields-less passkey step with the email fallback wired.
    const flow = JSON.parse(
      await readFile(join(cwd, ".zitadel/flows/default-login.json"), "utf8"),
    ) as {
      purposes: Record<string, string>;
      steps: Array<{ name: string; transitions?: Record<string, { target: string }> }>;
    };
    expect(flow.purposes).toMatchObject({ login: "passkey-first", register: "register" });
    expect(flow.steps.find((s) => s.name === "passkey-first")?.transitions).toMatchObject({
      email_fallback: { target: "identifier" },
      user_not_found: { target: "register" },
    });

    const schema = JSON.parse(
      await readFile(join(cwd, ".zitadel/schemas/default-human-user.json"), "utf8"),
    ) as { "x-auth-methods": Record<string, { position: number }> };
    expect(schema["x-auth-methods"].passkey?.position).toBe(1);

    // The chosen preset is recorded for later tooling.
    const zitadelJson = JSON.parse(await readFile(join(cwd, "zitadel.json"), "utf8")) as {
      preset?: string;
    };
    expect(zitadelJson.preset).toBe("passkey-first");

    // Preset scaffolds converge like the default: the first plan is empty.
    const plan = await cli(["plan", "--cwd", cwd, "--json"]);
    expect(plan.exitCode).toBe(0);
    const planJson = parseJson(plan.stdout) as { data: { total: number } };
    expect(planJson.data.total).toBe(0);
  });

  it("scaffolds business-use-case pages with the copy overlay and restores them alike", async () => {
    const cwd = await createNextProject();
    const setup = await cli([
      "setup",
      "--cwd",
      cwd,
      "--use-case",
      "business",
      "--non-interactive",
      "--json",
      "--skip-install",
    ]);
    expect(setup.exitCode).toBe(0);

    // The overlay ships with the SDK; the generated pages wire it up (via the
    // ref — React 18 safe) so the widget shows work-email wording while its
    // built-in copy stays neutral.
    const loginPage = await readFile(join(cwd, "app/login/page.tsx"), "utf8");
    expect(loginPage).toContain("element.locales = businessLocales");
    const registerPage = await readFile(join(cwd, "app/register/page.tsx"), "utf8");
    expect(registerPage).toContain("element.locales = businessLocales");
    // The choice is recorded so later tooling can regenerate the same markup.
    const zitadelJson = JSON.parse(await readFile(join(cwd, "zitadel.json"), "utf8")) as {
      useCase?: string;
    };
    expect(zitadelJson.useCase).toBe("business");

    // The A1×B2 seam: a repair regenerates the business-flavored markup, not
    // the neutral default — doctor restores the renderer context from
    // zitadel.json rather than assuming setup defaults.
    await rm(join(cwd, "app/login/page.tsx"));
    const fake = await fakeDocker();
    const port = await freePort();
    const fix = await cli(["doctor", "--cwd", cwd, "--json", "--fix", "--port", String(port)], {
      PATH: `${fake.binDir}:${process.env.PATH ?? ""}`,
      DOCKER_LOG: fake.logPath,
    });
    expect(fix.exitCode).toBe(0);
    const restored = await readFile(join(cwd, "app/login/page.tsx"), "utf8");
    expect(restored).toContain("element.locales = businessLocales");
  });

  it("catches server-side flow invariants at plan time, before any mutation", async () => {
    const cwd = await createNextProject();
    const fakeNpm = await fakePackageManager("npm");
    const setup = await cli(["setup", "--cwd", cwd, "--non-interactive", "--json"], {
      PACKAGE_MANAGER_LOG: fakeNpm.logPath,
      PATH: `${fakeNpm.binDir}:${process.env.PATH ?? ""}`,
    });
    expect(setup.exitCode).toBe(0);

    // The codex incident: drop the login entry's user_not_found transition.
    // The server rejects this on apply — but only after the schema (in the
    // combined-edit case) already revised. Plan must catch it first.
    const flowPath = join(cwd, ".zitadel/flows/default-login.json");
    const flow = JSON.parse(await readFile(flowPath, "utf8")) as {
      steps: Array<{ name: string; transitions: Record<string, unknown> }>;
    };
    const entry = flow.steps.find((s) => s.name === "identifier");
    delete entry?.transitions.user_not_found;
    await writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`);

    const before = snapshotPlatformStore();

    const plan = await cli(["plan", "--cwd", cwd, "--json"]);
    expect(plan.exitCode).toBe(3);
    const planJson = parseJson(plan.stdout) as { code: string; message: string };
    expect(planJson.code).toBe("E_VALIDATION");
    expect(planJson.message).toContain(
      'entry step for purpose "login" must wire "user_not_found" transition',
    );

    const apply = await cli(["apply", "--cwd", cwd, "--json"]);
    expect(apply.exitCode).toBe(3);
    // The partial-apply failure mode: nothing may have mutated.
    expect(snapshotPlatformStore()).toEqual(before);

    // Restoring the transition restores a clean plan.
    if (entry) {
      entry.transitions.user_not_found = { target: "register" };
    }
    await writeFile(flowPath, `${JSON.stringify(flow, null, 2)}\n`);
    const planAfter = await cli(["plan", "--cwd", cwd, "--json"]);
    expect(planAfter.exitCode).toBe(0);
    const planAfterJson = parseJson(planAfter.stdout) as { data: { total: number } };
    expect(planAfterJson.data.total).toBe(0);
  });

});

async function createNextProject(nextVersion = "^16.0.0"): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-next-"));
  await mkdir(join(cwd, "app"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "demo-next-app",
        private: true,
        dependencies: {
          next: nextVersion,
          react: "^19.0.0",
          "react-dom": "^19.0.0",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(join(cwd, ".gitignore"), "node_modules\n");
  await writeFile(
    join(cwd, "app/layout.tsx"),
    "export default function RootLayout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  return cwd;
}

async function fakePackageManager(name: "npm"): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-pm-"));
  const logPath = join(binDir, "package-manager.log");
  const binPath = join(binDir, name);
  await writeFile(
    binPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(
  process.env.PACKAGE_MANAGER_LOG,
  JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }) + "\\n",
);
process.stdout.write("fake npm stdout\\n");
process.stderr.write("fake npm stderr\\n");
process.exit(0);
`,
  );
  await chmod(binPath, 0o755);
  return { binDir, logPath };
}

async function fakeDocker(): Promise<{ binDir: string; logPath: string }> {
  const binDir = await mkdtemp(join(tmpdir(), "zitadel-fake-docker-"));
  const logPath = join(binDir, "docker.log");
  const dockerPath = join(binDir, "docker");
  await writeFile(
    dockerPath,
    `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "version") {
  console.log("29.0.0");
  process.exit(0);
}
if (args[0] === "pull") {
  console.log(args[args.length - 1]);
  process.exit(0);
}
process.exit(0);
`,
  );
  await chmod(dockerPath, 0o755);
  return { binDir, logPath };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (!address || typeof address === "string") {
    throw new Error("free port probe did not expose a TCP address");
  }
  return address.port;
}

async function expectedCliVersion(): Promise<string> {
  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return pkg.version;
}

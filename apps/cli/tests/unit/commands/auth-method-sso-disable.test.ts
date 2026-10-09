import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

// Temp dirs are left for the OS to reclaim, as the integration helper does
// (#1498): a recursive delete on teardown flakes under CI load.

type Envelope = {
  status: string;
  code?: string;
  message?: string;
  hint?: string;
  data?: Record<string, unknown>;
  warnings?: string[];
  next_commands?: string[];
  details?: { retry_args?: string[]; region?: string };
  reason?: string;
};

type Methods = Record<string, { enabled: boolean; providers?: string[] }>;

const schemaWith = (methods: Methods, name = "default-human-user") => ({
  $id: `https://schemas.test.invalid/${name}.json`,
  type: "object",
  "x-identifier": "email",
  required: ["email"],
  properties: { email: { type: "string", format: "email" } },
  "x-auth-methods": methods,
});

/** A login flow whose entry step offers these providers beside a password step. */
function flowOffering(providers: string[], name = "default-human-user") {
  return {
    name: `${name}-login`,
    status: "active",
    user_schema: `https://schemas.test.invalid/${name}.json`,
    purposes: { login: "identifier" },
    steps: [
      {
        name: "identifier",
        fields: ["email"],
        actions: [{ name: "submit", kind: "submit", primary: true }],
        sso_providers: providers,
        transitions: { submit: { target: "password" }, sso_authenticated: { target: "done" } },
      },
      {
        name: "password",
        fields: ["x-auth-methods#password"],
        actions: [{ name: "submit", kind: "submit", primary: true }],
        transitions: { submit: { target: "done" } },
      },
      { name: "done", complete: "show" },
    ],
  };
}

async function makeProject(methods: Methods, flowProviders: string[]): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-auth-method-sso-disable-"));
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  await writeFile(join(cwd, "zitadel.json"), `${JSON.stringify({ version: "0.0.1" })}\n`);
  await writeFile(
    join(cwd, ".zitadel/schemas/default-human-user.json"),
    `${JSON.stringify(schemaWith(methods))}\n`,
  );
  await writeFile(
    join(cwd, ".zitadel/flows/default-human-user-login.json"),
    `${JSON.stringify(flowOffering(flowProviders))}\n`,
  );
  return cwd;
}

/** Write one more file into a Project, for a test whose input is that file. */
async function writeJson(cwd: string, path: string, body: unknown): Promise<void> {
  await writeFile(join(cwd, path), `${JSON.stringify(body)}\n`);
}

const passwordAndGoogle: Methods = {
  password: { enabled: true },
  sso: { enabled: true, providers: ["google"] },
};

async function run(cwd: string, ...args: string[]) {
  const result = await runCliForTest([
    "auth-method",
    "sso",
    "disable",
    "--cwd",
    cwd,
    "--json",
    "--non-interactive",
    ...args,
  ]);
  return { exitCode: result.exitCode, envelope: parseJson(result.stdout) as Envelope };
}

async function readJson(cwd: string, path: string) {
  return JSON.parse(await readFile(join(cwd, path), "utf8")) as Record<string, unknown>;
}

async function ssoOf(cwd: string) {
  const schema = await readJson(cwd, ".zitadel/schemas/default-human-user.json");
  return (schema["x-auth-methods"] as Methods).sso;
}

async function entryProviders(cwd: string) {
  const flow = await readJson(cwd, ".zitadel/flows/default-human-user-login.json");
  const steps = flow.steps as Array<{ name: string; sso_providers?: string[] }>;
  return steps.find((step) => step.name === "identifier")?.sso_providers;
}

describe("auth-method sso disable", () => {
  it("removes the provider from the schema", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);

    await run(cwd, "--provider", "google");

    expect(await ssoOf(cwd)).toEqual({ enabled: false });
  });

  it("removes the provider from the flow", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);

    await run(cwd, "--provider", "google");

    expect(await entryProviders(cwd)).toBeUndefined();
  });

  it("keeps the other providers", async () => {
    const cwd = await makeProject(
      { password: { enabled: true }, sso: { enabled: true, providers: ["google", "github"] } },
      ["google", "github"],
    );

    await run(cwd, "--provider", "google");

    expect(await ssoOf(cwd)).toEqual({ enabled: true, providers: ["github"] });
    expect(await entryProviders(cwd)).toEqual(["github"]);
  });

  it("reports the files it changed and what is left", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);

    const { envelope } = await run(cwd, "--provider", "google");

    expect(envelope.data).toMatchObject({
      method: "sso",
      provider: "google",
      changed: true,
      files: [
        ".zitadel/schemas/default-human-user.json",
        ".zitadel/flows/default-human-user-login.json",
      ],
      usable: ["password"],
    });
  });

  it("changes nothing for a provider the schema does not offer", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);

    const { envelope } = await run(cwd, "--provider", "github");

    expect(envelope.data).toMatchObject({ changed: false, files: [], next_commands: [] });
  });

  it("previews without writing under --dry-run", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);

    const { envelope } = await run(cwd, "--provider", "google", "--dry-run");

    expect(envelope).toMatchObject({ status: "skipped", reason: "dry-run" });
    expect(await ssoOf(cwd)).toEqual({ enabled: true, providers: ["google"] });
    expect(await entryProviders(cwd)).toEqual(["google"]);
  });

  it("lists plan and apply, with --cwd, as the next commands after a change", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);

    const { envelope } = await run(cwd, "--provider", "google");

    expect(envelope.data?.next_args).toEqual([
      ["plan", "--cwd", expect.any(String)],
      ["apply", "--cwd", expect.any(String)],
    ]);
  });

  it("changes only the flow when the schema no longer lists the provider", async () => {
    const cwd = await makeProject({ password: { enabled: true } }, ["google"]);

    const { envelope } = await run(cwd, "--provider", "google");

    expect(envelope.data).toMatchObject({
      changed: true,
      files: [".zitadel/flows/default-human-user-login.json"],
    });
    expect(await entryProviders(cwd)).toBeUndefined();
  });

  it("changes only the named schema and its flows", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);
    await writeJson(cwd, ".zitadel/schemas/staff.json", schemaWith(passwordAndGoogle, "staff"));
    await writeJson(cwd, ".zitadel/flows/staff-login.json", flowOffering(["google"], "staff"));

    await run(cwd, "--provider", "google", "--schema", "staff");

    expect(await ssoOf(cwd)).toEqual({ enabled: true, providers: ["google"] });
    expect(await entryProviders(cwd)).toEqual(["google"]);
    const staff = await readJson(cwd, ".zitadel/schemas/staff.json");
    expect((staff["x-auth-methods"] as Methods).sso).toEqual({ enabled: false });
  });

  it("warns when the schema is left with methods no active flow offers", async () => {
    // Password is enabled, but the only flow signs in with Google alone.
    const flow = flowOffering(["google"]);
    const ssoOnly = {
      ...flow,
      steps: [
        {
          name: "identifier",
          sso_providers: ["google"],
          transitions: { sso_authenticated: { target: "done" } },
        },
        { name: "done", complete: "show" },
      ],
    };
    const cwd = await makeProject(passwordAndGoogle, []);
    await writeJson(cwd, ".zitadel/flows/default-human-user-login.json", ssoOnly);

    const { envelope } = await run(cwd, "--provider", "google");

    expect(envelope.warnings).toEqual([
      "No active login flow for default-human-user offers a method it enables, so nobody can sign in until one does.",
    ]);
  });

  describe("refusals", () => {
    it("asks for a provider and names the ones offered", async () => {
      const cwd = await makeProject(
        { password: { enabled: true }, sso: { enabled: true, providers: ["github"] } },
        ["github"],
      );

      const { envelope } = await run(cwd);

      expect(envelope).toMatchObject({
        code: "E_VALIDATION",
        message: "Name the provider to remove",
      });
      expect(envelope.hint).toContain("default-human-user offers: github.");
    });

    it("says when the schema offers no provider at all", async () => {
      const cwd = await makeProject({ password: { enabled: true } }, []);

      const { envelope } = await run(cwd);

      expect(envelope.hint).toContain("default-human-user offers: none.");
    });

    it("refuses to remove the last way to sign in and gives the --force re-run", async () => {
      const cwd = await makeProject(
        { password: { enabled: false }, sso: { enabled: true, providers: ["google"] } },
        ["google"],
      );

      const { envelope } = await run(cwd, "--provider", "google");

      expect(envelope.code).toBe("E_VALIDATION");
      expect(envelope.details?.retry_args).toEqual([
        "auth-method",
        "sso",
        "disable",
        "--provider",
        "google",
        "--schema",
        "default-human-user",
        "--cwd",
        expect.any(String),
        "--force",
      ]);
      expect(await ssoOf(cwd)).toEqual({ enabled: true, providers: ["google"] });
    });

    it("removes the last way to sign in with --force, and warns", async () => {
      const cwd = await makeProject(
        { password: { enabled: false }, sso: { enabled: true, providers: ["google"] } },
        ["google"],
      );

      const { envelope } = await run(cwd, "--provider", "google", "--force");

      expect(envelope.status).toBe("ok");
      expect(envelope.warnings).toContain(
        "default-human-user has no way to sign in left. Its users can only be managed through the API.",
      );
    });

    it("refuses a dry run that would remove the last way to sign in, keeping --dry-run", async () => {
      const cwd = await makeProject(
        { password: { enabled: false }, sso: { enabled: true, providers: ["google"] } },
        ["google"],
      );

      const { envelope } = await run(cwd, "--provider", "google", "--dry-run");

      expect(envelope.details?.retry_args).toEqual(
        expect.arrayContaining(["--dry-run", "--force"]),
      );
    });

    it("suggests enabling password or passkey instead of removing the last provider", async () => {
      const cwd = await makeProject(
        { password: { enabled: false }, sso: { enabled: true, providers: ["google"] } },
        ["google"],
      );

      const { envelope } = await run(cwd, "--provider", "google");

      expect(envelope.next_commands?.map((c) => c.replace(/^.*? auth-method /, ""))).toEqual([
        expect.stringMatching(
          /^sso disable --provider google --schema default-human-user --cwd \S+ --force$/,
        ),
        expect.stringMatching(/^password enable --schema default-human-user --cwd \S+$/),
        expect.stringMatching(/^passkey enable --schema default-human-user --cwd \S+$/),
      ]);
    });

    it("refuses while a flow has errors that prevent checking it", async () => {
      const cwd = await makeProject(passwordAndGoogle, ["google"]);
      const broken = { ...flowOffering(["google"]), purposes: { login: "missing" } };
      await writeJson(cwd, ".zitadel/flows/default-human-user-login.json", broken);

      const { envelope } = await run(cwd, "--provider", "google");

      expect(envelope.message).toContain("cannot be checked against the changed schema");
      expect(await ssoOf(cwd)).toEqual({ enabled: true, providers: ["google"] });
    });

    it("does not let --force past a flow it cannot check", async () => {
      const cwd = await makeProject(passwordAndGoogle, ["google"]);
      const broken = { ...flowOffering(["google"]), purposes: { login: "missing" } };
      await writeJson(cwd, ".zitadel/flows/default-human-user-login.json", broken);

      const { envelope } = await run(cwd, "--provider", "google", "--force");

      expect(envelope.message).toContain("cannot be checked against the changed schema");
    });

    it("refuses a schema that points at an external url", async () => {
      const cwd = await makeProject(passwordAndGoogle, ["google"]);
      await writeJson(cwd, ".zitadel/schemas/default-human-user.json", {
        kind: "schema-url",
        url: "https://schemas.test.invalid/customers.json",
      });

      const { envelope } = await run(cwd, "--provider", "google");

      expect(envelope.message).toBe(
        ".zitadel/schemas/default-human-user.json points at an external schema",
      );
    });

    it.each([
      ["x-auth-methods is not an object", { "x-auth-methods": [] }],
      ["x-auth-methods.sso is not an object", { "x-auth-methods": { sso: true } }],
      [
        "x-auth-methods.sso.enabled is not a boolean",
        { "x-auth-methods": { sso: { enabled: "true", providers: ["google"] } } },
      ],
    ])("refuses a schema where %s", async (region, methods) => {
      const cwd = await makeProject(passwordAndGoogle, ["google"]);
      await writeJson(cwd, ".zitadel/schemas/default-human-user.json", {
        ...schemaWith(passwordAndGoogle),
        ...methods,
      });

      const { envelope } = await run(cwd, "--provider", "google");

      expect(envelope).toMatchObject({ code: "E_VALIDATION", details: { region } });
    });

    it("refuses a flow whose provider list is not a list", async () => {
      const cwd = await makeProject(passwordAndGoogle, ["google"]);
      const flow = flowOffering(["google"]);
      await writeJson(cwd, ".zitadel/flows/default-human-user-login.json", {
        ...flow,
        steps: flow.steps.map((step) =>
          step.name === "identifier" ? { ...step, sso_providers: "google" } : step,
        ),
      });

      const { envelope } = await run(cwd, "--provider", "google");

      expect(envelope).toMatchObject({
        code: "E_VALIDATION",
        details: { region: "steps.identifier.sso_providers is not a list" },
      });
    });

    it("refuses an sso entry whose providers are not a list", async () => {
      const cwd = await makeProject(
        {
          password: { enabled: true },
          sso: { enabled: true, providers: "google" as unknown as string[] },
        },
        ["google"],
      );

      const { envelope } = await run(cwd, "--provider", "google");

      expect(envelope).toMatchObject({
        code: "E_VALIDATION",
        details: { region: "x-auth-methods.sso.providers is not a list" },
      });
    });
  });
});

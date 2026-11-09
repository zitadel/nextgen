import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { makeProject as writeProject, readJson, writeJson } from "@tests/helpers/local-project";
import { parseJson, runCliForTest } from "@tests/helpers/run-cli";

type Envelope = {
  status: string;
  code?: string;
  message?: string;
  hint?: string;
  data?: Record<string, unknown>;
  warnings?: string[];
  next_commands?: string[];
  details?: { suggested_args?: string[][]; region?: string };
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

/**
 * A login flow whose entry step offers these providers beside a password step.
 */
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

/**
 * A Project with one schema and its login flow, which offers these providers.
 */
function makeProject(methods: Methods, flowProviders: string[]): Promise<string> {
  return writeProject({
    schemas: { "default-human-user": schemaWith(methods) },
    flows: { "default-human-user-login": flowOffering(flowProviders) },
  });
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

/** A connection file under `.zitadel/idps/` for this slug. */
async function withConnection(cwd: string, slug: string) {
  await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
  await writeJson(cwd, `.zitadel/idps/${slug}.json`, { slug });
}

/** What the run said about the change, in order. */
function noticesOf(envelope: Envelope): string[] {
  const notices = (envelope.data?.notices ?? []) as Array<{ message: string }>;
  return notices.map((notice) => {
    return notice.message;
  });
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
      changed: [
        ".zitadel/schemas/default-human-user.json",
        ".zitadel/flows/default-human-user-login.json",
      ],
      usable: ["password"],
    });
  });

  describe("what it keeps", () => {
    const googleConnection = {
      slug: "google",
      protocol: "oidc",
      oidc: {
        issuer: "https://accounts.google.com",
        client_id: "${{ GOOGLE_CLIENT_ID }}",
        client_secret: "${{ GOOGLE_CLIENT_SECRET }}",
      },
    };

    /** The flow `sso enable` leaves: its two steps, and providers on the entry step. */
    function enabledFlow(providers: string[]) {
      const flow = flowOffering(providers);
      const [identifier, password, done] = flow.steps;
      return {
        ...flow,
        steps: [
          {
            ...identifier,
            transitions: {
              ...identifier?.transitions,
              sso_user_not_found: { target: "register-sso" },
              user_already_exists: { target: "sso-conflict" },
            },
          },
          password,
          {
            name: "register-sso",
            fields: ["email"],
            actions: [{ name: "submit", kind: "submit", primary: true }],
            on_success: "create_user_with_sso",
            transitions: { submit: { target: "done" } },
          },
          {
            name: "sso-conflict",
            fields: ["x-auth-methods#password"],
            actions: [{ name: "submit", kind: "submit", primary: true }],
            sso_providers: providers,
            transitions: {
              submit: { target: "done" },
              sso_authenticated: { target: "done" },
              sso_user_not_found: { target: "register-sso" },
            },
          },
          done,
        ],
      };
    }

    async function projectWithConnection(providers: string[]) {
      const cwd = await makeProject(
        { password: { enabled: true }, sso: { enabled: true, providers } },
        [],
      );
      await writeJson(cwd, ".zitadel/flows/default-human-user-login.json", enabledFlow(providers));
      await mkdir(join(cwd, ".zitadel/idps"));
      await writeJson(cwd, ".zitadel/idps/google.json", googleConnection);
      return cwd;
    }

    it("names the connection file, its variables and the steps it kept", async () => {
      const cwd = await projectWithConnection(["google"]);

      const { envelope } = await run(cwd, "--provider", "google");

      expect(envelope.data?.notices).toEqual([
        {
          severity: "info",
          message:
            ".zitadel/idps/google.json and the project variables GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET stay, " +
            "so enabling google again does not ask for its credentials. Deploys publish the connection until " +
            "you delete the file; the server keeps it either way, as deleting a connection is not supported yet.",
        },
        {
          severity: "info",
          message:
            "The steps register-sso and sso-conflict stay in .zitadel/flows/default-human-user-login.json " +
            "for the next provider you enable.",
        },
      ]);
      expect(await readJson(cwd, ".zitadel/idps/google.json")).toEqual(googleConnection);
    });

    it("says how to remove the connection: the file first, then its variables", async () => {
      const cwd = await projectWithConnection(["google"]);

      const { envelope } = await run(cwd, "--provider", "google");
      const actions = (envelope.data?.next_actions ?? []) as string[];

      expect(actions[0]).toBe(
        "To stop publishing the connection, delete .zitadel/idps/google.json before the deploy below.",
      );
      expect(actions[1]).toMatch(
        /^Once that deploy is live, remove its credentials: `\S[^`]* variable rm GOOGLE_CLIENT_ID --cwd [^`]+` and `\S[^`]* variable rm GOOGLE_CLIENT_SECRET --cwd [^`]+`$/,
      );
    });

    it("says what it kept and why in its text output", async () => {
      const cwd = await projectWithConnection(["google"]);

      const result = await runCliForTest([
        "auth-method",
        "sso",
        "disable",
        "--cwd",
        cwd,
        "--non-interactive",
        "--provider",
        "google",
      ]);

      expect(result.stdout + result.stderr).toContain(
        ".zitadel/idps/google.json and the project variables GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET stay",
      );
      expect(result.stdout + result.stderr).toContain("deleting a connection is not supported yet");
      expect(result.stdout + result.stderr).toContain(
        "The steps register-sso and sso-conflict stay in .zitadel/flows/default-human-user-login.json",
      );
    });

    it("does not name the steps while another provider still uses them", async () => {
      const cwd = await projectWithConnection(["google", "github"]);

      const { envelope } = await run(cwd, "--provider", "google");

      expect(noticesOf(envelope)).not.toContainEqual(expect.stringContaining("The steps"));
    });

    it("keeps the connection without a way to remove it while another schema offers it", async () => {
      const cwd = await projectWithConnection(["google"]);
      await writeJson(cwd, ".zitadel/schemas/staff.json", schemaWith(passwordAndGoogle, "staff"));

      const { envelope } = await run(cwd, "--provider", "google", "--schema", "default-human-user");

      expect(noticesOf(envelope)).toContain(
        ".zitadel/idps/google.json stays: google is still offered by .zitadel/schemas/staff.json.",
      );
      expect(envelope.data?.next_actions).toBeUndefined();
    });

    it("aims the variable rm commands at the environment the run named", async () => {
      const cwd = await projectWithConnection(["google"]);

      const { envelope } = await run(cwd, "--provider", "google", "--env", "production");
      const actions = (envelope.data?.next_actions ?? []) as string[];

      expect(actions[1]).toMatch(/variable rm GOOGLE_CLIENT_ID --env production --cwd [^`]+` and /);
      expect(actions[1]).toMatch(/variable rm GOOGLE_CLIENT_SECRET --env production --cwd [^`]+`$/);
    });

    it("keeps the connection while another schema's flow still offers it", async () => {
      const cwd = await projectWithConnection(["google"]);
      await writeJson(
        cwd,
        ".zitadel/schemas/staff.json",
        schemaWith({ password: { enabled: true } }, "staff"),
      );
      await writeJson(cwd, ".zitadel/flows/staff-login.json", flowOffering(["google"], "staff"));

      const { envelope } = await run(cwd, "--provider", "google", "--schema", "default-human-user");

      expect(noticesOf(envelope)).toContain(
        ".zitadel/idps/google.json stays: google is still offered by .zitadel/flows/staff-login.json.",
      );
    });

    it("says what it would keep on a dry run, and writes nothing", async () => {
      const cwd = await projectWithConnection(["google"]);

      const { envelope } = await run(cwd, "--provider", "google", "--dry-run");

      expect(envelope).toMatchObject({
        status: "skipped",
        data: {
          notices: expect.arrayContaining([
            expect.objectContaining({
              message: expect.stringContaining(".zitadel/idps/google.json and the project variables"),
            }),
          ]),
        },
      });
      expect(await ssoOf(cwd)).toEqual({ enabled: true, providers: ["google"] });
    });

    it("leaves out a variable another connection still names", async () => {
      const cwd = await projectWithConnection(["google"]);
      await writeJson(cwd, ".zitadel/idps/other.json", {
        ...googleConnection,
        slug: "other",
        oidc: { ...googleConnection.oidc, client_secret: "${{ OTHER_CLIENT_SECRET }}" },
      });

      const { envelope } = await run(cwd, "--provider", "google");

      expect(noticesOf(envelope)).toContainEqual(
        expect.stringContaining(
          ".zitadel/idps/google.json and the project variables GOOGLE_CLIENT_SECRET stay,",
        ),
      );
    });

    it("names a credential variable the file leaves to its slug", async () => {
      const cwd = await projectWithConnection(["google"]);
      const { client_secret: _derived, ...oidc } = googleConnection.oidc;
      await writeJson(cwd, ".zitadel/idps/google.json", { ...googleConnection, oidc });

      const { envelope } = await run(cwd, "--provider", "google");

      expect(noticesOf(envelope)).toContainEqual(
        expect.stringContaining(
          ".zitadel/idps/google.json and the project variables GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET stay,",
        ),
      );
    });

    it("refuses, naming the file, when a connection file is not valid JSON", async () => {
      const cwd = await projectWithConnection(["google"]);
      await writeFile(join(cwd, ".zitadel/idps/acme.json"), "{,}");

      const { envelope } = await run(cwd, "--provider", "google");

      expect(envelope).toMatchObject({
        status: "error",
        code: "E_VALIDATION",
        message: ".zitadel/idps/acme.json is not valid JSON",
      });
    });

    it("writes nothing when a connection file is not valid JSON", async () => {
      const cwd = await projectWithConnection(["google"]);
      await writeFile(join(cwd, ".zitadel/idps/acme.json"), "{,}");

      await run(cwd, "--provider", "google");

      expect(await ssoOf(cwd)).toEqual({ enabled: true, providers: ["google"] });
    });

    it("does not name the steps of a flow it did not change", async () => {
      const cwd = await projectWithConnection(["google"]);
      const untouched = { ...enabledFlow([]), name: "default-human-user-signup" };
      await writeJson(cwd, ".zitadel/flows/default-human-user-signup.json", untouched);

      const { envelope } = await run(cwd, "--provider", "google");

      expect(noticesOf(envelope)).not.toContainEqual(
        expect.stringContaining(".zitadel/flows/default-human-user-signup.json"),
      );
    });

    it("reports nothing kept when it changed nothing", async () => {
      const cwd = await projectWithConnection(["google"]);
      await withConnection(cwd, "github");

      const { envelope } = await run(cwd, "--provider", "github");

      expect(envelope.data?.notices).toEqual([]);
    });
  });

  it("changes nothing for a provider with a connection the schema does not offer", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);
    await withConnection(cwd, "github");

    const { exitCode, envelope } = await run(cwd, "--provider", "github");

    expect(exitCode).toBe(0);
    expect(envelope.data).toMatchObject({ changed: [], next_commands: [] });
  });

  it("says once that nothing changed", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);
    await withConnection(cwd, "github");

    const result = await runCliForTest([
      "auth-method",
      "sso",
      "disable",
      "--cwd",
      cwd,
      "--non-interactive",
      "--provider",
      "github",
    ]);

    const said = `${result.stdout}${result.stderr}`;
    expect(said.split("default-human-user does not offer github, so nothing changed")).toHaveLength(
      2,
    );
  });

  it("previews without writing under --dry-run", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);

    const { envelope } = await run(cwd, "--provider", "google", "--dry-run");

    expect(envelope).toMatchObject({ status: "skipped", reason: "dry-run" });
    expect(await ssoOf(cwd)).toEqual({ enabled: true, providers: ["google"] });
    expect(await entryProviders(cwd)).toEqual(["google"]);
  });

  it("lists the files a dry run would change", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);

    const { envelope } = await run(cwd, "--provider", "google", "--dry-run");

    expect(envelope.data?.changed).toEqual([
      ".zitadel/schemas/default-human-user.json",
      ".zitadel/flows/default-human-user-login.json",
    ]);
  });

  it("lists a dry run and a deploy, with --cwd, as the next commands after a change", async () => {
    const cwd = await makeProject(passwordAndGoogle, ["google"]);

    const { envelope } = await run(cwd, "--provider", "google");

    expect(envelope.data?.next_args).toEqual([
      ["deploy", "--dry-run", "--cwd", expect.any(String)],
      ["deploy", "-m", "<what changed>", "--cwd", expect.any(String)],
    ]);
  });

  it("changes only the flow when the schema no longer lists the provider", async () => {
    const cwd = await makeProject({ password: { enabled: true } }, ["google"]);

    const { envelope } = await run(cwd, "--provider", "google");

    expect(envelope.data).toMatchObject({
      changed: [".zitadel/flows/default-human-user-login.json"],
    });
    expect(await entryProviders(cwd)).toBeUndefined();
  });

  it("says it changed only the login flows when the schema no longer lists the provider", async () => {
    const cwd = await makeProject({ password: { enabled: true } }, ["google"]);

    const result = await runCliForTest([
      "auth-method",
      "sso",
      "disable",
      "--cwd",
      cwd,
      "--non-interactive",
      "--provider",
      "google",
    ]);

    expect(result.stdout).toContain("Removed google from the login flows of default-human-user");
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
    it("refuses a provider nothing offers and no connection names", async () => {
      const cwd = await makeProject(passwordAndGoogle, ["google"]);
      await withConnection(cwd, "google");

      const { exitCode, envelope } = await run(cwd, "--provider", "gogle");

      expect(exitCode).toBe(4);
      expect(envelope).toMatchObject({
        code: "E_NOT_FOUND",
        message: "default-human-user has no provider named gogle",
      });
      expect(await ssoOf(cwd)).toEqual({ enabled: true, providers: ["google"] });
    });

    it("refuses an unknown provider on a dry run too", async () => {
      const cwd = await makeProject(passwordAndGoogle, ["google"]);

      const { exitCode, envelope } = await run(cwd, "--provider", "gogle", "--dry-run");

      expect(exitCode).toBe(4);
      expect(envelope).toMatchObject({ status: "error", code: "E_NOT_FOUND" });
    });

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

      expect(envelope.code).toBe("E_CONFIRMATION_REQUIRED");
      expect(envelope.details?.suggested_args?.[0]).toEqual([
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
        "default-human-user is left with no way to sign in. Its users can only be managed through the API.",
      );
    });

    it("refuses removing the last way to sign in on a dry run, as the real run does", async () => {
      const cwd = await makeProject(
        { password: { enabled: false }, sso: { enabled: true, providers: ["google"] } },
        ["google"],
      );

      const dryRun = await run(cwd, "--provider", "google", "--dry-run");
      const real = await run(cwd, "--provider", "google");

      expect(dryRun.envelope).toMatchObject({
        code: "E_CONFIRMATION_REQUIRED",
        message: real.envelope.message,
      });
      expect(dryRun.envelope.details?.suggested_args?.[0]).toEqual([
        ...(real.envelope.details?.suggested_args?.[0] ?? []),
        "--dry-run",
      ]);
      expect(dryRun.envelope.details?.suggested_args?.slice(1)).toEqual(
        real.envelope.details?.suggested_args?.slice(1),
      );
    });

    it("previews removing the last way to sign in on a forced dry run, and warns", async () => {
      const cwd = await makeProject(
        { password: { enabled: false }, sso: { enabled: true, providers: ["google"] } },
        ["google"],
      );

      const { envelope } = await run(cwd, "--provider", "google", "--dry-run", "--force");

      expect(envelope).toMatchObject({
        status: "skipped",
        reason: "dry-run",
        warnings: [
          "default-human-user is left with no way to sign in. Its users can only be managed through the API.",
        ],
      });
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

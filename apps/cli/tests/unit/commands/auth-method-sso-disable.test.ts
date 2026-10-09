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
  hint?: string;
  data?: Record<string, unknown>;
  warnings?: string[];
  next_commands?: string[];
  details?: { retry_args?: string[]; region?: string };
};

type Methods = Record<string, { enabled: boolean; providers?: string[] }>;

const schemaWith = (methods: Methods) => ({
  $id: "https://schemas.test.invalid/default-human-user.json",
  type: "object",
  "x-identifier": "email",
  required: ["email"],
  properties: { email: { type: "string", format: "email" } },
  "x-auth-methods": methods,
});

/** A login flow whose entry step offers these providers beside a password step. */
function flowOffering(providers: string[]) {
  return {
    name: "default-human-user-login",
    status: "active",
    user_schema: "https://schemas.test.invalid/default-human-user.json",
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
  });

  describe("refusals", () => {
    it("asks for a provider and names the ones offered", async () => {
      const cwd = await makeProject(passwordAndGoogle, ["google"]);

      const { envelope } = await run(cwd);

      expect(envelope.code).toBe("E_VALIDATION");
      expect(envelope.hint).toContain("google");
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

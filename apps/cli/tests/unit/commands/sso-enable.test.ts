import { access, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

/** A Project as `zitadel setup` leaves it, minus what this command ignores. */
async function makeProject(schemas: Record<string, unknown> = {}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-sso-enable-alias-"));
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await writeFile(
    join(cwd, "zitadel.json"),
    `${JSON.stringify({ version: "0.0.1", environments: { development: { issuer: "http://localhost:3000" } } })}\n`,
  );
  await writeFile(
    join(cwd, ".zitadel/secret"),
    `${JSON.stringify({
      project_id: "proj_01TEST",
      project_secret: "s",
      preview_secret: "s",
      preview_origins: [],
      created_at: new Date().toISOString(),
    })}\n`,
  );
  const files = Object.keys(schemas).length > 0 ? schemas : { "default-human-user": defaultSchema };
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(cwd, `.zitadel/schemas/${name}.json`), `${JSON.stringify(body)}\n`);
    // Every schema gets the login flow that runs against it: the provider is
    // offered by a flow, so a project without one is not a project this
    // command can configure.
    await writeFile(
      join(cwd, `.zitadel/flows/${name}-login.json`),
      `${JSON.stringify(loginFlow(name))}\n`,
    );
  }
  // The README that ships beside the schemas must not be read as one.
  await writeFile(join(cwd, ".zitadel/schemas/README.md"), "# schemas\n");
  return cwd;
}

/** A login flow bound to a schema by the URL the scaffold writes. */
function loginFlow(schemaName: string) {
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
        transitions: { submit: { target: "done" } },
      },
      {
        name: "register",
        fields: ["email"],
        actions: [{ name: "submit", kind: "submit", primary: true }],
        transitions: { submit: { target: "done" } },
      },
      { name: "done", complete: "show" },
    ],
  };
}

const defaultSchema = {
  properties: { email: { type: "string" } },
  "x-auth-methods": { password: { enabled: true }, passkey: { enabled: true } },
};

/**
 * Run the command with a stand-in stdin, the way `variables` does: a scripted
 * run reads the secret from the stream, so leaving the real one in place
 * would block on a stream that never ends. Passing no `piped` value stands
 * for a terminal — nothing was piped.
 */
async function withStdin<T>(piped: string | undefined, run: () => Promise<T>): Promise<T> {
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

/** `sso enable` with a secret on stdin, as a scripted caller runs it. */
function ssoEnable(cwd: string, ...extra: string[]) {
  return withStdin("piped-secret", () =>
    runCliForTest([
      "sso",
      "enable",
      "--cwd",
      cwd,
      "--provider",
      "google",
      "--client-id",
      "1234-abc.apps.googleusercontent.com",
      "--json",
      "--non-interactive",
      ...extra,
    ]),
  );
}

const DEPRECATION =
  "`sso enable` is deprecated. Use `auth-method sso enable`, which takes the same flags.";

// `sso enable` is the deprecated alias of `auth-method sso enable` (ADR 069
// §6). Its behaviour is covered by auth-method-sso-enable.test.ts; this file
// covers only what the alias adds.
describe("sso enable (deprecated alias)", () => {
  it("still enables the provider", async () => {
    const cwd = await makeProject();

    const result = await ssoEnable(cwd);

    expect(result.exitCode).toBe(0);
    await expect(access(join(cwd, ".zitadel/idps/google.json"))).resolves.toBeUndefined();
  });

  it("names the command to use instead", async () => {
    const cwd = await makeProject();

    const result = await ssoEnable(cwd);

    const envelope = parseJson(result.stdout) as { warnings: string[] };
    expect(envelope.warnings).toContain(DEPRECATION);
  });

  it("names the command to use instead on a dry run too", async () => {
    const cwd = await makeProject();

    const result = await ssoEnable(cwd, "--dry-run");

    const envelope = parseJson(result.stdout) as { status: string; warnings: string[] };
    expect(envelope).toMatchObject({ status: "skipped", warnings: [DEPRECATION] });
  });
});

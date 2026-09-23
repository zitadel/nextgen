import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

const tempDirs: string[] = [];

/** A Project as `zitadel setup` leaves it, minus what this command ignores. */
async function makeProject(schemas: Record<string, unknown> = {}): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-sso-enable-"));
  tempDirs.push(cwd);
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
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(cwd, `.zitadel/schemas/${name}.json`), `${JSON.stringify(body)}\n`);
  }
  // The README that ships beside the schemas must not be read as one.
  await writeFile(join(cwd, ".zitadel/schemas/README.md"), "# schemas\n");
  return cwd;
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

function enable(cwd: string, ...extra: string[]) {
  return withStdin(undefined, () =>
    runCliForTest(["sso", "enable", "--cwd", cwd, "--provider", "google", "--json", ...extra]),
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

describe("sso enable", () => {
  it("writes the connection and reports what changed", async () => {
    const cwd = await makeProject();
    const result = await enable(cwd, "--client-id", "1234-abc.apps.googleusercontent.com");
    expect(result.exitCode).toBe(0);

    const payload = parseJson(result.stdout) as { data: Record<string, any> };
    expect(payload.data.connection).toMatchObject({
      action: "create",
      slug: "google",
      file: ".zitadel/idps/google.json",
    });
    expect(payload.data.callback_uri).toBe("http://localhost:3000/__nextgen/idp/callback");

    const written = JSON.parse(await readFile(join(cwd, ".zitadel/idps/google.json"), "utf8"));
    expect(written.oidc.client_id).toBe("1234-abc.apps.googleusercontent.com");
    // Only a reference, whatever the developer typed.
    expect(written.oidc.client_secret).toBe("${{ GOOGLE_CLIENT_SECRET }}");
    // The default schema defines only email, so the name claims are dropped.
    expect(written.claim_mapping).toEqual({ email: "email" });
  });

  it("reuses the connection on a second run and writes nothing new", async () => {
    const cwd = await makeProject();
    await enable(cwd, "--client-id", "1234-abc.apps.googleusercontent.com");
    const before = await readFile(join(cwd, ".zitadel/idps/google.json"), "utf8");

    const result = await enable(cwd);
    const payload = parseJson(result.stdout) as { data: Record<string, any> };
    expect(payload.data.connection.action).toBe("reuse");
    expect(await readFile(join(cwd, ".zitadel/idps/google.json"), "utf8")).toBe(before);
  });

  it("refuses a client id that is not the one already configured", async () => {
    const cwd = await makeProject();
    await enable(cwd, "--client-id", "1234-abc.apps.googleusercontent.com");

    const result = await enable(cwd, "--client-id", "999-zzz.apps.googleusercontent.com");
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("999-zzz.apps.googleusercontent.com");
  });

  it("names the schemas when the Project has more than one", async () => {
    const cwd = await makeProject({ customers: defaultSchema, employees: defaultSchema });
    const result = await enable(cwd, "--client-id", "1234-abc.apps.googleusercontent.com");
    expect(result.exitCode).not.toBe(0);
    const out = result.stdout + result.stderr;
    expect(out).toContain("customers");
    expect(out).toContain("employees");
  });

  it("changes the named schema when several exist", async () => {
    const cwd = await makeProject({ customers: defaultSchema, employees: defaultSchema });
    const result = await enable(cwd, "--schema", "employees", "--client-id", "1234-abc.apps.googleusercontent.com");
    const payload = parseJson(result.stdout) as { data: Record<string, any> };
    expect(payload.data.schema).toBe("employees");
  });

  it("changes nothing on a dry run", async () => {
    const cwd = await makeProject();
    const result = await enable(cwd, "--client-id", "1234-abc.apps.googleusercontent.com", "--dry-run");
    const payload = parseJson(result.stdout) as { status: string };
    expect(payload.status).toBe("skipped");
    await expect(readFile(join(cwd, ".zitadel/idps/google.json"), "utf8")).rejects.toThrow();
  });

  it("requires a client id when there is no one to ask", async () => {
    const cwd = await makeProject();
    const result = await enable(cwd);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("--client-id");
  });

  it("never puts the secret in its output", async () => {
    const cwd = await makeProject();
    const result = await enable(cwd, "--client-id", "1234-abc.apps.googleusercontent.com");
    expect(result.stdout).not.toContain("GOCSPX");
    expect(result.stderr).not.toContain("GOCSPX");
  });
});

describe("sso enable secret handling", () => {
  it("stores a secret piped in on a scripted run", async () => {
    const cwd = await makeProject();

    const result = await withStdin("piped-secret", () =>
      runCliForTest([
        "sso",
        "enable",
        "--cwd",
        cwd,
        "--provider",
        "google",
        "--json",
        "--client-id",
        "1234-abc.apps.googleusercontent.com",
        "--non-interactive",
      ]),
    );

    expect(result.exitCode).toBe(0);
    const env = await readFile(join(cwd, ".env.local"), "utf8");
    expect(env).toContain("GOOGLE_CLIENT_SECRET=piped-secret");
    // The value is never echoed back, only whether it was stored.
    expect(result.stdout).not.toContain("piped-secret");
  });

  it("does not block when a scripted run pipes nothing in", async () => {
    const cwd = await makeProject();

    const result = await enable(
      cwd,
      "--client-id",
      "1234-abc.apps.googleusercontent.com",
      "--non-interactive",
    );

    expect(result.exitCode).toBe(0);
    const json = parseJson(result.stdout) as { data: { secret: { stored: boolean } } };
    expect(json.data.secret.stored).toBe(false);
  });
});

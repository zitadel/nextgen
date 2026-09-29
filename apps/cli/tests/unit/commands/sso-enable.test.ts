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
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(cwd, `.zitadel/schemas/${name}.json`), `${JSON.stringify(body)}\n`);
    // Every schema gets the login flow that runs against it: the provider is
    // offered by a flow, so a project without one is not a project this
    // command can configure.
    await writeFile(join(cwd, `.zitadel/flows/${name}-login.json`), `${JSON.stringify(loginFlow(name))}\n`);
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

/**
 * Run the command with a secret on stdin, the way a scripted caller must:
 * both credentials are required, so a run without one is refused before it
 * writes anything. Tests about that refusal drive the CLI directly.
 */
function enable(cwd: string, ...extra: string[]) {
  return withStdin("piped-secret", () =>
    runCliForTest([
      "sso",
      "enable",
      "--cwd",
      cwd,
      "--provider",
      "google",
      "--json",
      "--non-interactive",
      ...extra,
    ]),
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
    // Neither credential is a literal: each environment registers its own
    // OAuth application, so both are references to project variables and one
    // connection file serves every environment.
    expect(written.oidc.client_id).toBe("${{ GOOGLE_CLIENT_ID }}");
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

  it("publishes a changed client id on reuse rather than ignoring it", async () => {
    // The connection references the id rather than holding it, so a rerun with
    // a different one has nothing in the file to disagree with. Republishing
    // is what makes the second invocation mean what it says; the previous
    // refusal only made sense while the id lived in the document.
    const cwd = await makeProject();
    await enable(cwd, "--client-id", "1234-abc.apps.googleusercontent.com");

    const result = await enable(cwd, "--client-id", "999-zzz.apps.googleusercontent.com");

    expect(result.exitCode).toBe(0);
    const json = parseJson(result.stdout) as {
      data: { connection: { action: string }; client_id: { variable: string } | null };
    };
    expect(json.data.connection.action).toBe("reuse");
    // Attempted, not skipped. No server is listening here, so it reports the
    // failure and the retry command rather than a publish.
    expect(json.data.client_id?.variable).toBe("GOOGLE_CLIENT_ID");
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

  it("names the next move when no provider was given", async () => {
    // oclif's own "Missing required flag provider" would be the one refusal in
    // this command carrying no hint, and every other error here says what to
    // do next.
    const cwd = await makeProject();

    const result = await withStdin(undefined, () =>
      runCliForTest(["sso", "enable", "--cwd", cwd, "--json"]),
    );

    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result.stdout) as { code: string; hint?: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.hint).toContain("--provider google");
  });

  it("writes the vendor's own connection on a scripted run", async () => {
    // Where a provider lives is asked for, and only on a development build:
    // the question belongs to whoever is working on the CLI, and a scripted
    // run has nobody to ask, so it gets the catalog's own issuer.
    const cwd = await makeProject();

    const result = await enable(cwd, "--client-id", "1234-abc.apps.googleusercontent.com");

    expect(result.exitCode).toBe(0);
    const written = JSON.parse(
      await readFile(join(cwd, ".zitadel/idps/google.json"), "utf8"),
    ) as { oidc: Record<string, unknown> };
    expect(written.oidc.issuer).toBe("https://accounts.google.com");
    // No endpoints: the vendor's are resolved from its discovery document.
    expect(written.oidc.authorization_endpoint).toBeUndefined();
    expect(written.oidc.token_endpoint).toBeUndefined();
    expect(written.oidc.client_secret).toBe("${{ GOOGLE_CLIENT_SECRET }}");
  });

  it("reuses the connection when rerun with the same client id", async () => {
    // A scaffolded connection stores `${{ GOOGLE_CLIENT_ID }}`, not an id, so
    // there is nothing in the file for a supplied id to disagree with. Reading
    // the reference as a literal made every rerun a conflict.
    const cwd = await makeProject();
    await enable(cwd, "--client-id", "1234-abc.apps.googleusercontent.com");

    const again = await enable(cwd, "--client-id", "1234-abc.apps.googleusercontent.com");

    expect(again.exitCode).toBe(0);
    const json = parseJson(again.stdout) as { data: { connection: { action: string } } };
    expect(json.data.connection.action).toBe("reuse");
  });

  it("still refuses a different client id on a hand-written connection", async () => {
    // A connection someone wrote by hand may hold a literal id, and reusing it
    // for another client would be silently wrong.
    const cwd = await makeProject();
    await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/idps/google.json"),
      `${JSON.stringify({
        slug: "google",
        template: "google",
        protocol: "oidc",
        oidc: { issuer: "https://accounts.google.com", client_id: "literal-one", client_secret: "${{ GOOGLE_CLIENT_SECRET }}" },
      })}\n`,
    );

    const result = await enable(cwd, "--client-id", "a-different-one");

    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result.stdout) as { code: string };
    expect(json.code).toBe("E_VALIDATION");
  });


  it("publishes to the variables the reused connection actually names", async () => {
    // A connection is an editable file and may point at its own variables.
    // Publishing to a slug-derived name would store the credential where the
    // connection never looks, and report it stored.
    const cwd = await makeProject();
    await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/idps/google.json"),
      `${JSON.stringify({
        slug: "google",
        template: "google",
        protocol: "oidc",
        oidc: {
          issuer: "https://accounts.google.com",
          client_id: "${{ ACME_GOOGLE_ID }}",
          client_secret: "${{ ACME_GOOGLE_SECRET }}",
        },
      })}\n`,
    );

    const result = await enable(cwd, "--client-id", "1234-abc.apps.googleusercontent.com");

    expect(result.exitCode).toBe(0);
    const json = parseJson(result.stdout) as {
      data: { client_id: { variable: string } | null; secret: { variable: string } | null };
    };
    expect(json.data.client_id?.variable).toBe("ACME_GOOGLE_ID");
    expect(json.data.secret?.variable).toBe("ACME_GOOGLE_SECRET");
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
    // Nothing is written to disk: the secret goes to the project's variables
    // and nowhere else, so there is no copy in the working tree to leak.
    await expect(readFile(join(cwd, ".env.local"), "utf8")).rejects.toThrow();
    expect(result.stdout).not.toContain("piped-secret");
    expect(result.stderr).not.toContain("piped-secret");
  });

  it("reports a publish the project never received, and how to retry it", async () => {
    // No server is listening on the Project's own address here, which is the
    // shape of every failure that matters: the connection references the
    // secret as `${{ NAME }}`, so a button whose credential never arrived
    // fails at token exchange rather than at enable time. The command must
    // say so and hand back the command that fixes it, not exit 0 quietly.
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
    const json = parseJson(result.stdout) as {
      data: { secret: { published: string; mirrored: string }; next_commands: string[] };
    };
    expect(json.data.secret).toEqual({
      variable: "GOOGLE_CLIENT_SECRET",
      published: "failed",
    });
    // Rendered as a command an agent can run, like every other result's.
    expect(json.data.next_commands).toEqual(
      expect.arrayContaining([expect.stringContaining("variables set GOOGLE_CLIENT_SECRET --secret")]),
    );
    expect(json.data.next_commands.every((command) => command.startsWith("npx "))).toBe(true);
  });

  it("refuses a scripted run that pipes nothing in, before writing anything", async () => {
    // Enabling a provider without its secret scaffolds a sign-in button that
    // fails at the token endpoint with invalid_client — in a browser, long
    // after this command reported success. Refusing here is the cheaper
    // failure, and it must leave no half-written connection behind.
    const cwd = await makeProject();

    const result = await withStdin("", () =>
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

    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result.stdout) as { code: string; hint?: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.hint).toContain("stdin");
    await expect(readFile(join(cwd, ".zitadel/idps/google.json"), "utf8")).rejects.toThrow();
  });

});

describe("sso enable with a connection already on disk", () => {
  it("still configures a second schema, rather than reporting a no-op", async () => {
    // The command's own example advertises `--schema customers`. Reusing the
    // connection must not skip the schema and flow edits: they are per-schema
    // and they are the point of the command.
    const cwd = await makeProject({
      customers: structuredClone(defaultSchema),
      employees: structuredClone(defaultSchema),
    });

    const first = await enable(cwd, "--client-id", "abc", "--schema", "customers");
    expect(first.exitCode).toBe(0);
    const second = await enable(cwd, "--schema", "employees");
    expect(second.exitCode).toBe(0);

    for (const name of ["customers", "employees"]) {
      const schema = JSON.parse(
        await readFile(join(cwd, `.zitadel/schemas/${name}.json`), "utf8"),
      ) as { "x-auth-methods": { sso?: { providers: string[] } } };
      expect(schema["x-auth-methods"].sso?.providers, name).toEqual(["google"]);

      const flow = JSON.parse(
        await readFile(join(cwd, `.zitadel/flows/${name}-login.json`), "utf8"),
      ) as { steps: Array<{ name: string; sso_providers?: string[] }> };
      const entry = flow.steps.find((s) => s.name === "identifier");
      expect(entry?.sso_providers, name).toEqual(["google"]);
    }
  });

  it("finishes a run interrupted after the connection file was written", async () => {
    const cwd = await makeProject();
    // What a Ctrl-C between the file write and the schema edit leaves behind.
    await mkdir(join(cwd, ".zitadel/idps"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/idps/google.json"),
      `${JSON.stringify({ slug: "google", template: "google", protocol: "oidc", oidc: { issuer: "https://accounts.google.com", client_id: "abc", client_secret: "${{ GOOGLE_CLIENT_SECRET }}" } })}\n`,
    );

    const result = await enable(cwd);

    expect(result.exitCode).toBe(0);
    const schema = JSON.parse(
      await readFile(join(cwd, ".zitadel/schemas/default-human-user.json"), "utf8"),
    ) as { "x-auth-methods": { sso?: { enabled: boolean } } };
    expect(schema["x-auth-methods"].sso?.enabled).toBe(true);
  });

  it("refuses when no flow runs against the schema, without touching anything", async () => {
    // The schema is the first thing the command would rewrite, so finding the
    // failure after writing it would leave `x-auth-methods.sso` enabled for a
    // provider the sign-in screen can never offer.
    const cwd = await makeProject();
    await rm(join(cwd, ".zitadel/flows/default-human-user-login.json"));
    const schemaPath = join(cwd, ".zitadel/schemas/default-human-user.json");
    const before = await readFile(schemaPath, "utf8");

    const result = await enable(cwd, "--client-id", "abc");

    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result.stdout) as { code: string; hint?: string };
    expect(json.code).toBe("E_NOT_FOUND");
    expect(json.hint).toContain(".zitadel/flows/");
    expect(await readFile(schemaPath, "utf8")).toBe(before);
    // Nor the connection, which is written before the schema is: failing after
    // it would leave a file and two published variables behind for a provider
    // the sign-in screen can never offer.
    await expect(readFile(join(cwd, ".zitadel/idps/google.json"), "utf8")).rejects.toThrow();
  });

  it("refuses a blank --client-id rather than taking it as one", async () => {
    // `--client-id "$CLIENT_ID"` with the variable unset is the common way
    // here. Taking it would bypass the prompt on create and, on reuse,
    // overwrite the project's variable with nothing.
    const cwd = await makeProject();

    const result = await enable(cwd, "--client-id", "   ");

    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("--client-id");
    await expect(readFile(join(cwd, ".zitadel/idps/google.json"), "utf8")).rejects.toThrow();
  });

  it("reports only a missing schema directory as no schemas", async () => {
    const cwd = await makeProject();
    // A directory that cannot be listed is not an empty one.
    await rm(join(cwd, ".zitadel/schemas"), { recursive: true });
    await writeFile(join(cwd, ".zitadel/schemas"), "not a directory");

    const result = await enable(cwd, "--client-id", "abc");

    expect(result.exitCode).not.toBe(0);
    expect((parseJson(result.stdout) as { code: string }).code).not.toBe("E_NOT_FOUND");
  });
});

describe("sso enable preflight", () => {
  it("fails a dry run for the same reason the real run would", async () => {
    // A preview that reports "would create" for an invocation that cannot
    // succeed is worse than no preview: it is checked precisely to find this
    // out before committing to it.
    const cwd = await makeProject();
    await rm(join(cwd, ".zitadel/flows/default-human-user-login.json"));

    const result = await enable(cwd, "--client-id", "abc", "--dry-run");

    expect(result.exitCode).not.toBe(0);
    expect((parseJson(result.stdout) as { code: string }).code).toBe("E_NOT_FOUND");
  });

  it("reports a malformed state file rather than matching flows by filename", async () => {
    // The fallback matches on a URL suffix rather than a synced id, so a
    // corrupt state file could silently point the command at a flow bound to
    // another schema.
    const cwd = await makeProject();
    await writeFile(join(cwd, ".zitadel/state.json"), "{ not json");

    const result = await enable(cwd, "--client-id", "abc", "--dry-run");

    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("state.json");
  });

  it("refuses a flow it cannot edit instead of overwriting the region", async () => {
    // `steps: "broken"` would otherwise read as no steps and be written back
    // as two generated ones, destroying whatever was there.
    const cwd = await makeProject();
    const flowPath = join(cwd, ".zitadel/flows/default-human-user-login.json");
    const flow = JSON.parse(await readFile(flowPath, "utf8")) as Record<string, unknown>;
    await writeFile(flowPath, JSON.stringify({ ...flow, steps: "broken" }, null, 2));

    const result = await enable(cwd, "--client-id", "abc");

    expect(result.exitCode).not.toBe(0);
    const json = parseJson(result.stdout) as { code: string; message: string };
    expect(json.code).toBe("E_VALIDATION");
    expect(json.message).toContain("steps is not a list");
    // Nothing written, nothing published: the flow keeps the value it had.
    expect((JSON.parse(await readFile(flowPath, "utf8")) as { steps: unknown }).steps).toBe(
      "broken",
    );
    await expect(readFile(join(cwd, ".zitadel/idps/google.json"), "utf8")).rejects.toThrow();
  });
});

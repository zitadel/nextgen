import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseJson, runCliForTest } from "../../helpers/run-cli";

const tempDirs: string[] = [];

type Envelope = {
  status: string;
  code?: string;
  data?: Record<string, unknown>;
  warnings?: string[];
  next_commands?: string[];
  details?: { issues?: Array<{ rule: string; step?: string }>; usable?: string[] };
};

const passwordSchema = (name = "default-human-user") => ({
  $id: `https://schemas.test.invalid/${name}.json`,
  type: "object",
  "x-identifier": "email",
  required: ["email"],
  properties: { email: { type: "string", format: "email" } },
  "x-auth-methods": { password: { enabled: true }, passkey: { enabled: true } },
});

/** The shipped password flow, cut to what the validator needs. */
const passwordFlow = (schemaName = "default-human-user") => ({
  name: `${schemaName}-login`,
  status: "active",
  user_schema: `https://schemas.test.invalid/${schemaName}.json`,
  purposes: { login: "identifier" },
  steps: [
    {
      name: "identifier",
      fields: ["email"],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      transitions: { submit: { target: "password" } },
    },
    {
      name: "password",
      fields: ["x-auth-methods#password"],
      actions: [{ name: "submit", kind: "submit", primary: true }],
      transitions: { submit: { target: "done" } },
    },
    { name: "done", complete: "show" },
  ],
});

/** A Project with the given schemas, each with its own login flow. */
async function makeProject(
  schemas: Record<string, Record<string, unknown>> = { "default-human-user": passwordSchema() },
  flows: Record<string, unknown> = { "default-human-user-login": passwordFlow() },
): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-auth-factor-"));
  tempDirs.push(cwd);
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await mkdir(join(cwd, ".zitadel/flows"), { recursive: true });
  await writeFile(join(cwd, "zitadel.json"), `${JSON.stringify({ version: "0.0.1" })}\n`);
  for (const [name, body] of Object.entries(schemas)) {
    await writeFile(join(cwd, `.zitadel/schemas/${name}.json`), `${JSON.stringify(body)}\n`);
  }
  for (const [name, body] of Object.entries(flows)) {
    await writeFile(join(cwd, `.zitadel/flows/${name}.json`), `${JSON.stringify(body)}\n`);
  }
  return cwd;
}

async function run(cwd: string, verb: "enable" | "disable", ...args: string[]) {
  const result = await runCliForTest([
    "auth-factor",
    verb,
    "--cwd",
    cwd,
    "--json",
    "--non-interactive",
    ...args,
  ]);
  return { exitCode: result.exitCode, envelope: parseJson(result.stdout) as Envelope };
}

async function readSchema(cwd: string, name = "default-human-user") {
  return JSON.parse(await readFile(join(cwd, `.zitadel/schemas/${name}.json`), "utf8")) as {
    "x-auth-methods": Record<string, { enabled: boolean }>;
  };
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("auth-factor", () => {
  describe("the envelope", () => {
    it("reports what changed, what was already set, and what is left", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "disable", "--mode", "passkey");

      expect(envelope.data).toMatchObject({
        schema: "default-human-user",
        file: ".zitadel/schemas/default-human-user.json",
        changed: ["passkey"],
        unchanged: [],
        enabled: ["password"],
      });
    });

    it("lists plan and apply as the next commands after a change", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "disable", "--mode", "passkey");

      const next = envelope.data?.next_commands as string[];
      expect(next.map((command) => command.split(" ").at(-1))).toEqual(["plan", "apply"]);
    });

    it("lists no next commands when nothing changed", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "enable", "--mode", "password");

      expect(envelope.data).toMatchObject({
        changed: [],
        unchanged: ["password"],
        next_commands: [],
      });
    });

    it("warns about a factor no flow offers", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "enable", "--mode", "passkey");

      expect(envelope.data?.not_offered).toEqual(["passkey"]);
      expect(envelope.warnings).toEqual([
        "No login flow for default-human-user offers passkey yet. Add it to a flow to show it.",
      ]);
    });
  });

  describe("--schema", () => {
    it("changes only the named schema", async () => {
      const cwd = await makeProject(
        { customers: passwordSchema("customers"), staff: passwordSchema("staff") },
        { "customers-login": passwordFlow("customers"), "staff-login": passwordFlow("staff") },
      );

      const { exitCode } = await run(cwd, "disable", "--mode", "passkey", "--schema", "staff");

      expect(exitCode).toBe(0);
      expect((await readSchema(cwd, "staff"))["x-auth-methods"].passkey).toEqual({
        enabled: false,
      });
      expect((await readSchema(cwd, "customers"))["x-auth-methods"].passkey).toEqual({
        enabled: true,
      });
    });

    it("is required when the Project has more than one schema", async () => {
      const cwd = await makeProject(
        { customers: passwordSchema("customers"), staff: passwordSchema("staff") },
        {},
      );

      const { envelope } = await run(cwd, "disable", "--mode", "passkey");

      expect(envelope).toMatchObject({ status: "error", code: "E_VALIDATION" });
    });
  });

  describe("refusals", () => {
    it("names the rule and step a disabled factor would break", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "disable", "--mode", "password");

      expect(envelope.code).toBe("E_VALIDATION");
      expect(envelope.details?.issues).toEqual([
        expect.objectContaining({ rule: "schema/fields-resolve", step: "password" }),
      ]);
    });

    it("refuses to disable while a flow has errors that prevent checking it", async () => {
      const broken = { ...passwordFlow(), purposes: { login: "identifier", register: "missing" } };
      const cwd = await makeProject(undefined, { "default-human-user-login": broken });

      const { envelope } = await run(cwd, "disable", "--mode", "password");

      expect(envelope.code).toBe("E_VALIDATION");
      expect(envelope.details?.issues).toEqual([expect.objectContaining({ rule: "definition" })]);
    });

    it("refuses to remove the last way to sign in and says how to add another", async () => {
      const cwd = await makeProject(
        {
          "default-human-user": {
            ...passwordSchema(),
            "x-auth-methods": { password: { enabled: false }, passkey: { enabled: true } },
          },
        },
        {},
      );

      const { envelope } = await run(cwd, "disable", "--mode", "passkey");

      expect(envelope.code).toBe("E_VALIDATION");
      expect(envelope.details?.usable).toEqual(["passkey"]);
      expect(
        envelope.next_commands?.some((c) =>
          c.endsWith("--mode password --schema default-human-user"),
        ),
      ).toBe(true);
    });

    it("does not count otp as a way to sign in", async () => {
      const cwd = await makeProject(
        {
          "default-human-user": {
            ...passwordSchema(),
            "x-auth-methods": { passkey: { enabled: true }, otp: { enabled: true } },
          },
        },
        {},
      );

      const { envelope } = await run(cwd, "disable", "--mode", "passkey");

      expect(envelope.code).toBe("E_VALIDATION");
    });

    it("refuses password on a schema with no x-identifier", async () => {
      const { "x-identifier": _, ...noIdentifier } = passwordSchema();
      const cwd = await makeProject(
        {
          "default-human-user": {
            ...noIdentifier,
            "x-auth-methods": { password: { enabled: false }, passkey: { enabled: true } },
          },
        },
        {},
      );

      const { envelope } = await run(cwd, "enable", "--mode", "password");

      expect(envelope).toMatchObject({ code: "E_VALIDATION", details: { factor: "password" } });
    });

    it("refuses under --dry-run too", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "disable", "--mode", "password", "--dry-run");

      expect(envelope.code).toBe("E_VALIDATION");
    });

    it("writes nothing when it refuses", async () => {
      const cwd = await makeProject();
      const before = await readSchema(cwd);

      await run(cwd, "disable", "--mode", "password");

      expect(await readSchema(cwd)).toEqual(before);
    });
  });

  describe("--force", () => {
    const passkeyOnly = () => ({
      "default-human-user": {
        ...passwordSchema(),
        "x-auth-methods": { password: { enabled: false }, passkey: { enabled: true } },
      },
    });

    it("disables the last factor, which the server allows", async () => {
      const cwd = await makeProject(passkeyOnly(), {});

      const { exitCode } = await run(cwd, "disable", "--mode", "passkey", "--force");

      expect(exitCode).toBe(0);
      expect((await readSchema(cwd))["x-auth-methods"].passkey).toEqual({ enabled: false });
    });

    it("warns that nobody can sign in afterwards", async () => {
      const cwd = await makeProject(passkeyOnly(), {});

      const { envelope } = await run(cwd, "disable", "--mode", "passkey", "--force");

      expect(envelope.warnings).toEqual([
        "default-human-user has no way to sign in left. Its users can only be managed through the API.",
      ]);
    });

    it("does not override a flow that still uses the factor", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "disable", "--mode", "password", "--force");

      expect(envelope.code).toBe("E_VALIDATION");
    });
  });

  describe("--dry-run", () => {
    it("still reports the warnings", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "enable", "--mode", "passkey", "--dry-run");

      expect(envelope.warnings).toEqual([
        "No login flow for default-human-user offers passkey yet. Add it to a flow to show it.",
      ]);
    });

    it("previews the change without writing it", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "disable", "--mode", "passkey", "--dry-run");

      expect(envelope).toMatchObject({ status: "skipped", reason: "dry-run" });
      expect(envelope.data?.changed).toEqual(["passkey"]);
      expect((await readSchema(cwd))["x-auth-methods"].passkey).toEqual({ enabled: true });
    });
  });

  it("asks for a factor rather than guessing one", async () => {
    const cwd = await makeProject();

    const { envelope } = await run(cwd, "disable");

    expect(envelope).toMatchObject({ status: "error", code: "E_VALIDATION" });
  });
});

import { chmod, mkdir, mkdtemp, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COMMANDS } from "../../../src/index";
import { parseJson, runCliForTest } from "../../helpers/run-cli";

type Envelope = {
  status: string;
  code?: string;
  message?: string;
  hint?: string;
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
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-auth-method-"));
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

async function run(
  cwd: string,
  method: "password" | "passkey",
  verb: "enable" | "disable",
  ...args: string[]
) {
  const result = await runCliForTest([
    "auth-method",
    method,
    verb,
    "--cwd",
    cwd,
    "--json",
    "--non-interactive",
    ...args,
  ]);
  return { exitCode: result.exitCode, envelope: parseJson(result.stdout) as Envelope };
}

/** A suggested command with the CLI prefix and the temp --cwd path left out. */
function suggested(command: string): string {
  return command.replace(/^.*? auth-method /, "").replace(/--cwd \S+/, "--cwd <cwd>");
}

/** A schema whose only enabled factor is passkey. */
function passkeyOnlySchema() {
  return {
    "default-human-user": {
      ...passwordSchema(),
      "x-auth-methods": { password: { enabled: false }, passkey: { enabled: true } },
    },
  };
}

async function readSchema(cwd: string, name = "default-human-user") {
  return JSON.parse(await readFile(join(cwd, `.zitadel/schemas/${name}.json`), "utf8")) as {
    "x-auth-methods": Record<string, { enabled: boolean }>;
  };
}

// Temp dirs are left for the OS to reclaim, as the integration helper does
// (#1498): a recursive delete on teardown flakes under CI load.

describe("auth-method password and passkey", () => {
  describe("the envelope", () => {
    it("reports the schema, the method, whether it changed and what is left", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "passkey", "disable");

      expect(envelope.data).toMatchObject({
        schema: "default-human-user",
        file: ".zitadel/schemas/default-human-user.json",
        method: "passkey",
        changed: true,
        usable: ["password"],
        not_offered: [],
      });
    });

    it("lists plan and apply as the next commands after a change", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "passkey", "disable");

      const next = envelope.data?.next_commands as string[];
      expect(
        next.map((command) => command.replace(/^.*?@\S+ /, "").replace(/--cwd \S+/, "--cwd <cwd>")),
      ).toEqual(["plan --cwd <cwd>", "apply --cwd <cwd>"]);
    });

    it("hands over the follow-ups as argument lists when the path needs quoting", async () => {
      const parent = await mkdtemp(join(tmpdir(), "zitadel auth factor "));
      const cwd = await makeProject();
      const spaced = join(parent, "my project");
      await rename(cwd, spaced);

      const { envelope } = await run(spaced, "passkey", "disable");

      expect(envelope.data?.next_commands).toEqual([]);
      expect(envelope.data?.next_args).toEqual([
        ["plan", "--cwd", expect.stringContaining("my project")],
        ["apply", "--cwd", expect.stringContaining("my project")],
      ]);
    });

    it("refuses a schema that points at an external url", async () => {
      const cwd = await makeProject(
        {
          "default-human-user": {
            kind: "schema-url",
            url: "https://schemas.test.invalid/customers.json",
          },
        },
        {},
      );

      const { envelope } = await run(cwd, "passkey", "disable");

      expect(envelope).toMatchObject({
        code: "E_VALIDATION",
        details: { url: "https://schemas.test.invalid/customers.json" },
      });
    });

    it("works with a local server that is not running", async () => {
      const cwd = await makeProject();

      const { exitCode } = await run(cwd, "passkey", "disable", "--server", "local");

      expect(exitCode).toBe(0);
    });

    it("lists no next commands when nothing changed", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "password", "enable");

      expect(envelope.data).toMatchObject({ changed: false, next_commands: [] });
    });

    it("does not count a register step that only enrols a passkey", async () => {
      const flow = passwordFlow();
      const enrolling = {
        ...flow,
        purposes: { login: "identifier", register: "register" },
        steps: [
          // A combined flow must route each purpose to the other.
          {
            ...flow.steps[0],
            transitions: { ...flow.steps[0]?.transitions, user_not_found: { target: "register" } },
          },
          ...flow.steps.slice(1),
          {
            name: "register",
            fields: ["email"],
            actions: [{ name: "passkey_register", kind: "passkey_register", primary: true }],
            transitions: {
              passkey_register: { target: "done" },
              user_already_exists: { target: "identifier" },
            },
          },
        ],
      };
      const cwd = await makeProject(
        {
          "default-human-user": {
            ...passwordSchema(),
            "x-auth-methods": { password: { enabled: true }, passkey: { enabled: false } },
          },
        },
        { "default-human-user-login": enrolling },
      );

      const { envelope } = await run(cwd, "passkey", "enable");

      expect(envelope.data?.not_offered).toEqual(["passkey"]);
    });

    it("does not count a draft flow as offering the factor", async () => {
      const draft = {
        ...passwordFlow(),
        name: "draft-login",
        status: "draft",
        steps: [
          {
            name: "passkey-first",
            fields: [],
            actions: [{ name: "passkey", kind: "passkey", primary: true }],
            transitions: { passkey: { target: "done" } },
          },
          { name: "done", complete: "show" },
        ],
        purposes: { login: "passkey-first" },
      };
      const cwd = await makeProject(undefined, {
        "default-human-user-login": passwordFlow(),
        "draft-login": draft,
      });

      const { envelope } = await run(cwd, "passkey", "enable");

      expect(envelope.data?.not_offered).toEqual(["passkey"]);
    });

    it("warns when no active flow offers any method the schema enables", async () => {
      // Copilot's lockout case: password steps removed from the flow, passkey
      // enabled but never offered, then password disabled.
      const noPassword = {
        ...passwordFlow(),
        steps: [
          {
            name: "identifier",
            fields: ["email"],
            actions: [{ name: "submit", kind: "submit", primary: true }],
            transitions: { submit: { target: "done" } },
          },
          { name: "done", complete: "show" },
        ],
      };
      const cwd = await makeProject(undefined, { "default-human-user-login": noPassword });

      const { envelope } = await run(cwd, "password", "disable");

      expect(envelope.warnings).toEqual([
        "No active login flow for default-human-user offers a method it enables, so nobody can sign in until one does.",
      ]);
    });

    it("warns about a factor no flow offers", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "passkey", "enable");

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

      const { exitCode } = await run(cwd, "passkey", "disable", "--schema", "staff");

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

      const { envelope } = await run(cwd, "passkey", "disable");

      expect(envelope).toMatchObject({ status: "error", code: "E_VALIDATION" });
      expect(envelope.hint).toContain("Name the one to change with --schema");
    });
  });

  describe("refusals", () => {
    it("names the rule and step a disabled factor would break", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "password", "disable");

      expect(envelope.code).toBe("E_VALIDATION");
      expect(envelope.details?.issues).toEqual([
        expect.objectContaining({ rule: "schema/fields-resolve", step: "password" }),
      ]);
    });

    it("refuses to enable while a flow has errors that prevent checking it", async () => {
      const broken = { ...passwordFlow(), purposes: { login: "identifier", register: "missing" } };
      const cwd = await makeProject(
        {
          "default-human-user": {
            ...passwordSchema(),
            "x-auth-methods": { password: { enabled: true }, passkey: { enabled: false } },
          },
        },
        { "default-human-user-login": broken },
      );

      const { envelope } = await run(cwd, "passkey", "enable");

      expect(envelope.code).toBe("E_VALIDATION");
      expect(envelope.details?.issues).toEqual([expect.objectContaining({ rule: "definition" })]);
    });

    it("refuses to disable while a flow has errors that prevent checking it", async () => {
      const broken = { ...passwordFlow(), purposes: { login: "identifier", register: "missing" } };
      const cwd = await makeProject(undefined, { "default-human-user-login": broken });

      const { envelope } = await run(cwd, "password", "disable");

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

      const { envelope } = await run(cwd, "passkey", "disable");

      expect(envelope.code).toBe("E_VALIDATION");
      expect(envelope.details?.usable).toEqual(["passkey"]);
      expect(envelope.next_commands?.map(suggested)).toEqual([
        "passkey disable --schema default-human-user --cwd <cwd> --force",
        "password enable --schema default-human-user --cwd <cwd>",
      ]);
    });

    it("does not suggest password on a schema with no x-identifier", async () => {
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

      const { envelope } = await run(cwd, "passkey", "disable");

      expect(envelope.next_commands?.map(suggested)).toEqual([
        "passkey disable --schema default-human-user --cwd <cwd> --force",
      ]);
    });

    it("leaves a schema name that needs quoting out of runnable commands", async () => {
      const cwd = await makeProject(
        {
          "my users&calc": {
            ...passwordSchema("my users&calc"),
            "x-auth-methods": { password: { enabled: false }, passkey: { enabled: true } },
          },
        },
        {},
      );

      const { envelope } = await run(cwd, "passkey", "disable");

      expect(envelope.next_commands ?? []).toEqual([]);
      expect(envelope.details).toMatchObject({
        retry_args: [
          "auth-method",
          "passkey",
          "disable",
          "--schema",
          "my users&calc",
          "--cwd",
          expect.any(String),
          "--force",
        ],
        suggested_args: [
          expect.arrayContaining(["disable", "--force"]),
          [
            "auth-method",
            "password",
            "enable",
            "--schema",
            "my users&calc",
            "--cwd",
            expect.any(String),
          ],
        ],
      });
    });

    it("refuses a factor entry with no enabled value", async () => {
      const cwd = await makeProject(
        {
          "default-human-user": {
            ...passwordSchema(),
            "x-auth-methods": { password: { enabled: true }, passkey: {} },
          },
        },
        {},
      );

      const { envelope } = await run(cwd, "passkey", "disable");

      expect(envelope).toMatchObject({
        code: "E_VALIDATION",
        details: { region: "x-auth-methods.passkey.enabled is not a boolean" },
      });
    });

    it("refuses to disable while a flow file does not match the flow schema", async () => {
      const flow = passwordFlow();
      const malformed = {
        ...flow,
        steps: flow.steps.map((step) =>
          step.name === "password" ? { ...step, fields: "x-auth-methods#password" } : step,
        ),
      };
      const cwd = await makeProject(undefined, { "default-human-user-login": malformed });

      const { envelope } = await run(cwd, "password", "disable");

      expect(envelope.code).toBe("E_VALIDATION");
      expect(envelope.details?.issues).toEqual([
        expect.objectContaining({
          rule: "definition",
          path: ".zitadel/flows/default-human-user-login.json",
        }),
      ]);
    });

    it("joins a schema name that starts with a dash to its option", async () => {
      const cwd = await makeProject(
        {
          "--force": {
            ...passwordSchema("--force"),
            "x-auth-methods": { password: { enabled: false }, passkey: { enabled: true } },
          },
        },
        {},
      );

      const { envelope } = await run(cwd, "passkey", "disable");

      expect(envelope.next_commands ?? []).toEqual([]);
      expect(envelope.details).toMatchObject({
        retry_args: expect.arrayContaining(["--schema=--force", "--force"]),
      });
      expect(envelope.details).toMatchObject({
        retry_args: expect.not.arrayContaining(["--schema"]),
      });
    });

    it("refuses an enabled value that is not a boolean", async () => {
      const cwd = await makeProject(
        {
          "default-human-user": {
            ...passwordSchema(),
            "x-auth-methods": { password: { enabled: true }, passkey: { enabled: "true" } },
          },
        },
        {},
      );

      const { envelope } = await run(cwd, "passkey", "disable");

      expect(envelope).toMatchObject({
        code: "E_VALIDATION",
        details: { region: "x-auth-methods.passkey.enabled is not a boolean" },
      });
    });

    it("refuses an x-auth-methods that is not an object rather than overwrite it", async () => {
      const cwd = await makeProject(
        { "default-human-user": { ...passwordSchema(), "x-auth-methods": [] } },
        {},
      );

      const { envelope } = await run(cwd, "passkey", "enable");

      expect(envelope).toMatchObject({
        code: "E_VALIDATION",
        details: { region: "x-auth-methods is not an object" },
      });
    });

    it("refuses a factor entry that is not an object rather than overwrite it", async () => {
      const cwd = await makeProject(
        {
          "default-human-user": {
            ...passwordSchema(),
            "x-auth-methods": { password: true, passkey: { enabled: true } },
          },
        },
        {},
      );

      const { envelope } = await run(cwd, "password", "disable");

      expect(envelope).toMatchObject({
        code: "E_VALIDATION",
        details: { region: "x-auth-methods.password is not an object" },
      });
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

      const { envelope } = await run(cwd, "passkey", "disable");

      expect(envelope.message).toBe(
        ".zitadel/schemas/default-human-user.json would have no way to sign in left",
      );
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

      const { envelope } = await run(cwd, "password", "enable");

      expect(envelope).toMatchObject({ code: "E_VALIDATION", details: { factor: "password" } });
    });

    it("keeps --dry-run in the suggestions of a refused dry run", async () => {
      const cwd = await makeProject(passkeyOnlySchema(), {});

      const { envelope } = await run(cwd, "passkey", "disable", "--dry-run");

      expect(envelope.details).toMatchObject({
        retry_args: expect.arrayContaining(["--dry-run", "--force"]),
      });
      expect(envelope.next_commands).toHaveLength(2);
      for (const command of envelope.next_commands ?? []) {
        expect(command).toContain("--dry-run");
      }
    });

    it("refuses under --dry-run too", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "password", "disable", "--dry-run");

      expect(envelope.details?.issues).toEqual([
        expect.objectContaining({ rule: "schema/fields-resolve", step: "password" }),
      ]);
    });

    it("writes nothing when it refuses", async () => {
      const cwd = await makeProject();
      const before = await readSchema(cwd);

      await run(cwd, "password", "disable");

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

      const { exitCode } = await run(cwd, "passkey", "disable", "--force");

      expect(exitCode).toBe(0);
      expect((await readSchema(cwd))["x-auth-methods"].passkey).toEqual({ enabled: false });
    });

    it("warns that nobody can sign in afterwards", async () => {
      const cwd = await makeProject(passkeyOnly(), {});

      const { envelope } = await run(cwd, "passkey", "disable", "--force");

      expect(envelope.warnings).toEqual([
        "default-human-user has no way to sign in left. Its users can only be managed through the API.",
      ]);
    });

    // Root ignores file modes, so a read-only file is still written there.
    it.skipIf(process.getuid?.() === 0)(
      "does not claim the change when the schema cannot be written",
      async () => {
        const cwd = await makeProject(passkeyOnly(), {});
        await chmod(join(cwd, ".zitadel/schemas/default-human-user.json"), 0o444);

        const { envelope } = await run(cwd, "passkey", "disable", "--force");

        expect(envelope.status).toBe("error");
        expect(envelope).not.toHaveProperty("warnings");
      },
    );

    it("does not override a flow that still uses the factor", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "password", "disable", "--force");

      expect(envelope.details?.issues).toEqual([
        expect.objectContaining({ rule: "schema/fields-resolve", step: "password" }),
      ]);
    });
  });

  describe("--dry-run", () => {
    it("still reports the warnings", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "passkey", "enable", "--dry-run");

      expect(envelope.warnings).toEqual([
        "No login flow for default-human-user offers passkey yet. Add it to a flow to show it.",
      ]);
    });

    it("previews the change without writing it", async () => {
      const cwd = await makeProject();

      const { envelope } = await run(cwd, "passkey", "disable", "--dry-run");

      expect(envelope).toMatchObject({ status: "skipped", reason: "dry-run" });
      expect(envelope.data?.changed).toBe(true);
      expect((await readSchema(cwd))["x-auth-methods"].passkey).toEqual({ enabled: true });
    });
  });

  // Every suggestion is meant to be run as written, so each must name a real
  // command: a renamed command would otherwise leave dead suggestions behind.
  it("only suggests commands that exist", async () => {
    const cwd = await makeProject(passkeyOnlySchema(), {});
    const refused = await run(cwd, "passkey", "disable");
    const changed = await run(await makeProject(), "passkey", "disable");

    const suggested = [
      ...(refused.envelope.next_commands ?? []),
      ...((changed.envelope.data?.next_commands as string[]) ?? []),
    ];

    expect(suggested.length).toBeGreaterThan(0);
    for (const command of suggested) {
      const words = command.replace(/^npx \S+ /, "").split(" ");
      const firstFlag = words.findIndex((word) => word.startsWith("-"));
      const id = words.slice(0, firstFlag === -1 ? words.length : firstFlag).join(":");
      expect(Object.keys(COMMANDS), command).toContain(id);
    }
  });
});

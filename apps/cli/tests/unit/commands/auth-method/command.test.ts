import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { cancel, confirm, isCancel } from "@clack/prompts";
import { Config } from "@oclif/core";

import AuthMethodPasskeyDisable from "../../../../src/commands/auth-method/passkey/disable";
import AuthMethodSsoDisable from "../../../../src/commands/auth-method/sso/disable";
import { readSchemaFiles, type SchemaFile, selectSchema } from "../../../../src/lib/idp";
import { type Permit, readSchemaTarget } from "../../../../src/commands/auth-method/command";
import { forcedConsent } from "../../../helpers/consent";
import {
  defaultSchema,
  makeProject,
  readJson,
  setUpProject,
  writeJson,
} from "../../../helpers/local-project";
import { cliPackageRoot } from "../../../helpers/oclif-build";

// The terminal paths of the auth-method base class: the confirmation that
// guards the last way to sign in, and the runs that never prompt. The command
// tests run --non-interactive against the built CLI, which bundles its own
// prompts, so a prompt can only be answered by running the command classes
// from source, where `input` is the one module that asks.

// Restored exactly as found, so a stream that had no own `isTTY` gets none
// back.
const tty = {
  stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
  stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
};

function restore(stream: NodeJS.WriteStream | NodeJS.ReadStream, found?: PropertyDescriptor) {
  if (found === undefined) {
    delete (stream as { isTTY?: boolean }).isTTY;
  } else {
    Object.defineProperty(stream, "isTTY", found);
  }
}

beforeEach(() => {
  // A terminal on both ends is what makes the command interactive.
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
});

afterEach(async () => {
  restore(process.stdout, tty.stdout);
  restore(process.stdin, tty.stdin);
  vi.mocked(confirm).mockReset();
  vi.mocked(cancel).mockReset();
  // Back to "not cancelled", so a one-off answer a failing test left unused
  // cannot leak into the next test.
  vi.mocked(isCancel).mockReset().mockReturnValue(false);
});

/**
 * Run a command class in-process with its output kept out of the test log:
 * oclif prints through console.log and console.error, consola through the
 * streams.
 */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  return run();
}

const schemaWith = (methods: Record<string, unknown>) => ({
  type: "object",
  "x-identifier": "email",
  properties: { email: { type: "string" } },
  "x-auth-methods": methods,
});

/**
 * A Project whose only enabled method is passkey, with no flows to stop the
 * change.
 */
function passkeyOnlyProject(): Promise<string> {
  return makeProject({
    schemas: {
      "default-human-user": schemaWith({
        password: { enabled: false },
        passkey: { enabled: true },
      }),
    },
  });
}

/** The `x-auth-methods` entry of one method, as the run left it. */
async function methodOf(cwd: string, method: string): Promise<unknown> {
  const schema = await readJson(cwd, ".zitadel/schemas/default-human-user.json");
  return (schema["x-auth-methods"] as Record<string, unknown>)[method];
}

async function disablePasskey(cwd: string, ...extra: string[]) {
  const config = await Config.load({ root: cliPackageRoot });
  return quietly(() =>
    AuthMethodPasskeyDisable.run(["--cwd", cwd, "--no-telemetry", ...extra], config),
  );
}

describe("auth-method passkey disable confirmation", () => {
  it("asks before removing the last way to sign in", async () => {
    const cwd = await passkeyOnlyProject();
    vi.mocked(confirm).mockResolvedValue(false as never);

    await disablePasskey(cwd);

    expect(confirm).toHaveBeenCalledOnce();
  });

  it("ends as skipped and writes nothing when declined", async () => {
    const cwd = await passkeyOnlyProject();
    vi.mocked(confirm).mockResolvedValue(false as never);

    const envelope = await disablePasskey(cwd);

    expect(envelope).toMatchObject({ status: "skipped", reason: "disable-cancelled" });
    expect(await methodOf(cwd, "passkey")).toEqual({ enabled: true });
  });

  it("disables the method and warns when confirmed", async () => {
    const cwd = await passkeyOnlyProject();
    vi.mocked(confirm).mockResolvedValue(true as never);

    const envelope = await disablePasskey(cwd);

    expect(envelope).toMatchObject({
      status: "ok",
      warnings: [
        "default-human-user has no way to sign in left. Its users can only be managed through the API.",
      ],
    });
    expect(await methodOf(cwd, "passkey")).toEqual({ enabled: false });
  });
});

describe("auth-method passkey disable cancelled with Ctrl-C", () => {
  it("fails, as every cancelled prompt does", async () => {
    const cwd = await passkeyOnlyProject();
    vi.mocked(confirm).mockResolvedValue(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await expect(disablePasskey(cwd)).rejects.toThrow();

    expect(cancel).toHaveBeenCalledWith("Cancelled.");
  });

  it("writes nothing", async () => {
    const cwd = await passkeyOnlyProject();
    vi.mocked(confirm).mockResolvedValue(Symbol("cancel") as never);
    vi.mocked(isCancel).mockReturnValueOnce(true);

    await disablePasskey(cwd).catch(() => undefined);

    expect(await methodOf(cwd, "passkey")).toEqual({ enabled: true });
  });
});

/** A Project whose only way to sign in is Google. */
function googleOnlyProject(): Promise<string> {
  return makeProject({
    schemas: {
      "default-human-user": schemaWith({
        password: { enabled: false },
        sso: { enabled: true, providers: ["google"] },
      }),
    },
  });
}

async function disableGoogle(cwd: string) {
  const config = await Config.load({ root: cliPackageRoot });
  return quietly(() =>
    AuthMethodSsoDisable.run(["--provider", "google", "--cwd", cwd, "--no-telemetry"], config),
  );
}

describe("auth-method sso disable confirmation", () => {
  it("asks before removing the last way to sign in", async () => {
    const cwd = await googleOnlyProject();
    vi.mocked(confirm).mockResolvedValue(false as never);

    await disableGoogle(cwd);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Disable google anyway? Nobody will be able to sign in to default-human-user.",
      }),
    );
  });

  it("ends as skipped and writes nothing when declined", async () => {
    const cwd = await googleOnlyProject();
    vi.mocked(confirm).mockResolvedValue(false as never);

    const envelope = await disableGoogle(cwd);

    expect(envelope).toMatchObject({ status: "skipped", reason: "disable-cancelled" });
    expect(await methodOf(cwd, "sso")).toEqual({ enabled: true, providers: ["google"] });
  });

  it("removes the provider and warns when confirmed", async () => {
    const cwd = await googleOnlyProject();
    vi.mocked(confirm).mockResolvedValue(true as never);

    const envelope = await disableGoogle(cwd);

    expect(envelope).toMatchObject({
      status: "ok",
      warnings: [
        "default-human-user has no way to sign in left. Its users can only be managed through the API.",
      ],
    });
    expect(await methodOf(cwd, "sso")).toEqual({ enabled: false });
  });
});

describe("auth-method passkey disable in a terminal without a prompt", () => {
  it("does not ask on a dry run", async () => {
    const cwd = await passkeyOnlyProject();

    await disablePasskey(cwd, "--dry-run");

    expect(confirm).not.toHaveBeenCalled();
  });

  it("previews a dry run, and warns, rather than refusing", async () => {
    const cwd = await passkeyOnlyProject();

    const envelope = await disablePasskey(cwd, "--dry-run");

    expect(envelope).toMatchObject({
      status: "skipped",
      reason: "dry-run",
      warnings: [
        "default-human-user would have no way to sign in left. Its users can only be managed through the API.",
      ],
    });
    expect(await methodOf(cwd, "passkey")).toEqual({ enabled: true });
  });

  it("does not ask when --force is passed", async () => {
    const cwd = await passkeyOnlyProject();

    const envelope = await disablePasskey(cwd, "--force");

    expect(confirm).not.toHaveBeenCalled();
    expect(envelope).toMatchObject({ status: "ok" });
  });
});

describe("auth-method passkey disable run from inside the Project", () => {
  it("suggests a dry run and a deploy without --cwd", async () => {
    const cwd = await passkeyOnlyProject();
    await writeJson(
      cwd,
      ".zitadel/schemas/default-human-user.json",
      schemaWith({ password: { enabled: true }, passkey: { enabled: true } }),
    );
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const config = await Config.load({ root: cliPackageRoot });

    const envelope = await quietly(() =>
      AuthMethodPasskeyDisable.run(["--no-telemetry", "--non-interactive"], config),
    );

    expect(envelope).toMatchObject({
      data: {
        next_args: [
          ["deploy", "--dry-run"],
          ["deploy", "-m", "<what changed>"],
        ],
      },
    });
  });
});

/** The passkey command with its schema write reachable, to drive the write's own guard. */
class SchemaWriter extends AuthMethodPasskeyDisable {
  write(cwd: string, schema: SchemaFile, after: Record<string, unknown>, permit: Permit) {
    return this.writeSchema(cwd, schema, after, permit);
  }
}

/** A writer, and the change that leaves `passkeyOnlyProject` no way to sign in. */
async function lastMethodWrite(cwd: string) {
  const writer = new SchemaWriter([], await Config.load({ root: cliPackageRoot }));
  const schema = selectSchema(await readSchemaFiles(cwd), undefined);
  const after = schemaWith({ password: { enabled: false }, passkey: { enabled: false } });
  return { writer, schema, after };
}

describe("auth-method schema write", () => {
  it("refuses a change that leaves no way to sign in without consent", async () => {
    const cwd = await passkeyOnlyProject();
    const { writer, schema, after } = await lastMethodWrite(cwd);

    await expect(writer.write(cwd, schema, after, "not-the-last-method")).rejects.toThrow(
      "A destructive operation ran without consent",
    );
  });

  it("writes nothing when it refuses", async () => {
    const cwd = await passkeyOnlyProject();
    const { writer, schema, after } = await lastMethodWrite(cwd);

    await writer.write(cwd, schema, after, "not-the-last-method").catch(() => undefined);

    expect(await methodOf(cwd, "passkey")).toEqual({ enabled: true });
  });

  it("refuses to write during a dry run", async () => {
    const cwd = await passkeyOnlyProject();
    const { writer, schema, after } = await lastMethodWrite(cwd);

    await expect(writer.write(cwd, schema, after, "dry-run")).rejects.toThrow(
      "A dry run tried to write",
    );
  });

  it("writes a change that leaves no way to sign in with consent", async () => {
    const cwd = await passkeyOnlyProject();
    const { writer, schema, after } = await lastMethodWrite(cwd);

    await writer.write(cwd, schema, after, await forcedConsent());

    expect(await methodOf(cwd, "passkey")).toEqual({ enabled: false });
  });
});

function target(cwd: string, flags: { schema?: string; cwdGiven?: boolean } = {}) {
  return readSchemaTarget({
    cwd,
    schema: flags.schema,
    cwdGiven: flags.cwdGiven ?? false,
  });
}

describe("readSchemaTarget", () => {
  it("finds the only schema and the flows that run against it", async () => {
    const cwd = await setUpProject();

    await expect(target(cwd)).resolves.toMatchObject({
      schema: {
        name: "default-human-user",
      },
      cwdArgs: [],
    });
  });

  it("carries --cwd into the follow-ups when the run had one", async () => {
    const cwd = await setUpProject();

    await expect(target(cwd, { cwdGiven: true })).resolves.toMatchObject({
      cwdArgs: ["--cwd", cwd],
    });
  });

  it("chooses the schema --schema names", async () => {
    const cwd = await setUpProject({
      customers: defaultSchema,
      employees: defaultSchema,
    });

    await expect(target(cwd, { schema: "employees" })).resolves.toMatchObject({
      schema: {
        name: "employees",
      },
    });
  });

  it("chooses the schema whose objectType --schema names, as a flow's user_schema does", async () => {
    const cwd = await setUpProject({
      customers: { ...defaultSchema, objectType: "customer" },
      employees: { ...defaultSchema, objectType: "employee" },
    });

    await expect(target(cwd, { schema: "employee" })).resolves.toMatchObject({
      schema: { name: "employees" },
    });
  });

  it("refuses a name that fits more than one schema, and settles it by file", async () => {
    const cwd = await setUpProject({
      "default-human-user": defaultSchema,
      "human-user": { ...defaultSchema, objectType: "staff" },
    });

    await expect(target(cwd, { schema: "human-user" })).rejects.toMatchObject({
      code: "E_VALIDATION",
      message:
        "More than one user schema is named human-user: default-human-user (human-user), human-user (staff)",
      hint: "Name the one to change by its file: --schema default-human-user.json or --schema human-user.json",
      details: { requested: "human-user", candidates: ["default-human-user", "human-user"] },
    });
    await expect(target(cwd, { schema: "human-user.json" })).resolves.toMatchObject({
      schema: { name: "human-user" },
    });
  });

  it("lists each known schema by file and objectType when none is named", async () => {
    const cwd = await setUpProject({
      customers: { ...defaultSchema, objectType: "customer" },
      employees: { ...defaultSchema, objectType: "employees" },
    });

    await expect(target(cwd)).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "This Project has more than one user schema",
      hint: "Name the one to change with --schema. Known schemas: customers (customer), employees",
    });
    await expect(target(cwd, { schema: "staff" })).rejects.toMatchObject({
      code: "E_NOT_FOUND",
      message: "This Project has no user schema named staff",
      hint: "Known schemas: customers (customer), employees",
      details: {
        known: ["customers", "employees"],
        schemas: [
          { name: "customers", object_type: "customer" },
          { name: "employees", object_type: "employees" },
        ],
      },
    });
  });

  it("refuses a Project with more than one schema and none named", async () => {
    const cwd = await setUpProject({
      customers: defaultSchema,
      employees: defaultSchema,
    });

    await expect(target(cwd)).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: "This Project has more than one user schema",
    });
  });

  it("refuses a Project with no schema", async () => {
    const cwd = await makeProject();

    await expect(target(cwd)).rejects.toMatchObject({
      code: "E_NOT_FOUND",
    });
  });

  it("refuses a schema that points at an external url, naming the file and the url", async () => {
    const cwd = await makeProject({
      schemas: {
        remote: {
          kind: "schema-url",
          url: "https://schemas.test.invalid/remote.json",
        },
      },
    });

    await expect(target(cwd)).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: ".zitadel/schemas/remote.json points at an external schema",
      details: {
        file: ".zitadel/schemas/remote.json",
        url: "https://schemas.test.invalid/remote.json",
      },
    });
  });
});

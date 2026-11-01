import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { cancel, confirm, isCancel } from "@clack/prompts";
import { Config } from "@oclif/core";

import AuthMethodPasskeyDisable from "../../../../src/commands/auth-method/passkey/disable";
import AuthMethodSsoDisable from "../../../../src/commands/auth-method/sso/disable";
import { readSchemaFiles, type SchemaFile, selectSchema } from "../../../../src/lib/idp";
import type { Permit } from "../../../../src/lib/oclif";
import { forcedConsent } from "../../../helpers/consent";
import { makeProject, readJson, writeJson } from "../../../helpers/local-project";
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
  vi.restoreAllMocks();
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

    await expect(writer.write(cwd, schema, after, "keeps-a-method")).rejects.toThrow(
      "A destructive operation ran without consent",
    );
  });

  it("writes nothing when it refuses", async () => {
    const cwd = await passkeyOnlyProject();
    const { writer, schema, after } = await lastMethodWrite(cwd);

    await writer.write(cwd, schema, after, "keeps-a-method").catch(() => undefined);

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

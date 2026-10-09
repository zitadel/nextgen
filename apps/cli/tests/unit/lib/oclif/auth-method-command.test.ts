import { confirm, isCancel } from "@clack/prompts";
import { Config } from "@oclif/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AuthMethodPasskeyDisable from "../../../../src/commands/auth-method/passkey/disable";
import AuthMethodSsoDisable from "../../../../src/commands/auth-method/sso/disable";
import { makeProject, readJson, writeJson } from "../../../helpers/local-project";
import { cliPackageRoot } from "../../../helpers/oclif-build";

// The terminal paths of the auth-method base class: the confirmation that
// guards the last way to sign in, and the runs that never prompt. The command
// tests run --non-interactive against the built CLI, where a prompt cannot be
// answered; this file runs the command classes in-process, so it can mock the
// prompt (a module-level vi.mock, which is why it is a file of its own).
vi.mock("@clack/prompts", async (importOriginal) => {
  const original = await importOriginal<typeof import("@clack/prompts")>();
  return {
    ...original,
    confirm: vi.fn(),
    cancel: vi.fn(),
    // Real by default; a test answering with Ctrl-C makes it say so once.
    isCancel: vi.fn(original.isCancel),
  };
});

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
  // Back to the real check, so a one-off answer a failing test left unused
  // cannot leak into the next test.
  const original = await vi.importActual<typeof import("@clack/prompts")>("@clack/prompts");
  vi.mocked(isCancel).mockReset().mockImplementation(original.isCancel);
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
    vi.mocked(confirm).mockResolvedValue(false);

    await disablePasskey(cwd);

    expect(confirm).toHaveBeenCalledOnce();
  });

  it("ends as skipped and writes nothing when declined", async () => {
    const cwd = await passkeyOnlyProject();
    vi.mocked(confirm).mockResolvedValue(false);

    const envelope = await disablePasskey(cwd);

    expect(envelope).toMatchObject({ status: "skipped", reason: "disable-cancelled" });
    expect(await methodOf(cwd, "passkey")).toEqual({ enabled: true });
  });

  it("disables the method and warns when confirmed", async () => {
    const cwd = await passkeyOnlyProject();
    vi.mocked(confirm).mockResolvedValue(true);

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
  it("ends as skipped and writes nothing", async () => {
    const cwd = await passkeyOnlyProject();
    vi.mocked(confirm).mockResolvedValue(Symbol("cancel"));
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const envelope = await disablePasskey(cwd);

    expect(envelope).toMatchObject({ status: "skipped", reason: "disable-cancelled" });
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
    vi.mocked(confirm).mockResolvedValue(false);

    await disableGoogle(cwd);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Disable google anyway? Nobody will be able to sign in to default-human-user.",
      }),
    );
  });

  it("ends as skipped and writes nothing when declined", async () => {
    const cwd = await googleOnlyProject();
    vi.mocked(confirm).mockResolvedValue(false);

    const envelope = await disableGoogle(cwd);

    expect(envelope).toMatchObject({ status: "skipped", reason: "disable-cancelled" });
    expect(await methodOf(cwd, "sso")).toEqual({ enabled: true, providers: ["google"] });
  });

  it("removes the provider and warns when confirmed", async () => {
    const cwd = await googleOnlyProject();
    vi.mocked(confirm).mockResolvedValue(true);

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
  it("suggests plan and apply without --cwd", async () => {
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

    expect(envelope).toMatchObject({ data: { next_args: [["plan"], ["apply"]] } });
  });
});

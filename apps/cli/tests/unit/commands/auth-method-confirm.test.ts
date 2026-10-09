import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { confirm, isCancel } from "@clack/prompts";
import { Config } from "@oclif/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PasskeyDisable from "../../../src/commands/auth-method/passkey/disable";
import SsoDisable from "../../../src/commands/auth-method/sso/disable";
import { cliPackageRoot } from "../../helpers/oclif-build";

// The terminal paths of the shared auth-method base (src/commands/auth-method/
// shared.ts): the confirmation that guards the last way to sign in, and the
// runs that never prompt. The other auth-method tests run --non-interactive
// against the built CLI, where a prompt cannot be answered; this file runs the
// command classes in-process, so it can mock the prompt (a module-level
// vi.mock, which is why it is a file of its own).
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

// Restored exactly as found, so a stream that had no own `isTTY` gets none back.
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
 * oclif prints through console.log and console.error, consola through the streams.
 */
async function quietly<T>(run: () => Promise<T>): Promise<T> {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  return run();
}

/** A Project whose only enabled factor is passkey, with no flows to stop the change. */
async function passkeyOnlyProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-auth-method-confirm-"));
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await writeFile(join(cwd, "zitadel.json"), `${JSON.stringify({ version: "0.0.1" })}\n`);
  await writeFile(
    join(cwd, ".zitadel/schemas/default-human-user.json"),
    `${JSON.stringify({
      type: "object",
      "x-identifier": "email",
      properties: { email: { type: "string" } },
      "x-auth-methods": { password: { enabled: false }, passkey: { enabled: true } },
    })}\n`,
  );
  return cwd;
}

async function passkey(cwd: string): Promise<unknown> {
  const schema = JSON.parse(
    await readFile(join(cwd, ".zitadel/schemas/default-human-user.json"), "utf8"),
  ) as { "x-auth-methods": Record<string, unknown> };
  return schema["x-auth-methods"].passkey;
}

async function disablePasskey(cwd: string, ...extra: string[]) {
  const config = await Config.load({ root: cliPackageRoot });
  return quietly(() => PasskeyDisable.run(["--cwd", cwd, "--no-telemetry", ...extra], config));
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
    expect(await passkey(cwd)).toEqual({ enabled: true });
  });

  it("disables the factor and warns when confirmed", async () => {
    const cwd = await passkeyOnlyProject();
    vi.mocked(confirm).mockResolvedValue(true);

    const envelope = await disablePasskey(cwd);

    expect(envelope).toMatchObject({
      status: "ok",
      warnings: [
        "default-human-user has no way to sign in left. Its users can only be managed through the API.",
      ],
    });
    expect(await passkey(cwd)).toEqual({ enabled: false });
  });
});

describe("auth-method passkey disable cancelled with Ctrl-C", () => {
  it("ends as skipped and writes nothing", async () => {
    const cwd = await passkeyOnlyProject();
    vi.mocked(confirm).mockResolvedValue(Symbol("cancel"));
    vi.mocked(isCancel).mockReturnValueOnce(true);

    const envelope = await disablePasskey(cwd);

    expect(envelope).toMatchObject({ status: "skipped", reason: "disable-cancelled" });
    expect(await passkey(cwd)).toEqual({ enabled: true });
  });
});

/** A Project whose only way to sign in is Google, offered by its one flow. */
async function googleOnlyProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-auth-method-confirm-sso-"));
  await mkdir(join(cwd, ".zitadel/schemas"), { recursive: true });
  await writeFile(join(cwd, "zitadel.json"), `${JSON.stringify({ version: "0.0.1" })}\n`);
  await writeFile(
    join(cwd, ".zitadel/schemas/default-human-user.json"),
    `${JSON.stringify({
      type: "object",
      "x-identifier": "email",
      properties: { email: { type: "string" } },
      "x-auth-methods": {
        password: { enabled: false },
        sso: { enabled: true, providers: ["google"] },
      },
    })}\n`,
  );
  return cwd;
}

async function sso(cwd: string): Promise<unknown> {
  const schema = JSON.parse(
    await readFile(join(cwd, ".zitadel/schemas/default-human-user.json"), "utf8"),
  ) as { "x-auth-methods": Record<string, unknown> };
  return schema["x-auth-methods"].sso;
}

async function disableGoogle(cwd: string) {
  const config = await Config.load({ root: cliPackageRoot });
  return quietly(() =>
    SsoDisable.run(["--provider", "google", "--cwd", cwd, "--no-telemetry"], config),
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
    expect(await sso(cwd)).toEqual({ enabled: true, providers: ["google"] });
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
    expect(await sso(cwd)).toEqual({ enabled: false });
  });
});

describe("auth-method passkey disable in a terminal without a prompt", () => {
  it("refuses a dry run instead of asking", async () => {
    const cwd = await passkeyOnlyProject();

    await expect(disablePasskey(cwd, "--dry-run")).rejects.toThrow();

    expect(confirm).not.toHaveBeenCalled();
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
    await writeFile(
      join(cwd, ".zitadel/schemas/default-human-user.json"),
      `${JSON.stringify({
        type: "object",
        "x-identifier": "email",
        properties: { email: { type: "string" } },
        "x-auth-methods": { password: { enabled: true }, passkey: { enabled: true } },
      })}\n`,
    );
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const config = await Config.load({ root: cliPackageRoot });

    const envelope = await quietly(() =>
      PasskeyDisable.run(["--no-telemetry", "--non-interactive"], config),
    );

    expect(envelope).toMatchObject({ data: { next_args: [["plan"], ["apply"]] } });
  });
});

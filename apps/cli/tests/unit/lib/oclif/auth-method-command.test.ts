import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

import { cancel, confirm, isCancel } from "@clack/prompts";
import { Config } from "@oclif/core";

import AuthMethodPasskeyDisable from "../../../../src/commands/auth-method/passkey/disable";
import AuthMethodSsoDisable from "../../../../src/commands/auth-method/sso/disable";
import { makeProject, readJson, writeJson } from "../../../helpers/local-project";
import { cliPackageRoot } from "../../../helpers/oclif-build";
import { asTerminalTyping } from "../../../helpers/terminal";

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
 * Runs a command class in-process with a person typing `answers` at the plain
 * questions it asks, and its output kept out of the test log: oclif prints
 * through console.log and console.error, consola through the streams. What
 * was written comes back, since a plain question is written rather than drawn.
 */
async function quietly<T>(
  answers: readonly string[],
  run: () => Promise<T>,
): Promise<{ result: T; shown: string }> {
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  return asTerminalTyping(answers, run);
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

async function disablePasskey(answers: readonly string[], cwd: string, ...extra: string[]) {
  const config = await Config.load({ root: cliPackageRoot });
  return quietly(answers, () =>
    AuthMethodPasskeyDisable.run(["--cwd", cwd, "--no-telemetry", ...extra], config),
  );
}

describe("auth-method passkey disable confirmation", () => {
  it("asks before removing the last way to sign in", async () => {
    const cwd = await passkeyOnlyProject();

    const { shown } = await disablePasskey(["n"], cwd);

    expect(shown).toContain("Disable passkey anyway?");
  });

  // A normal command asks on one plain line, with no chain around it.
  it("asks it plainly rather than as a drawn prompt", async () => {
    const cwd = await passkeyOnlyProject();

    const { shown } = await disablePasskey(["n"], cwd);

    expect(confirm).not.toHaveBeenCalled();
    expect(shown).toContain("? ");
  });

  it("ends as skipped and writes nothing when declined", async () => {
    const cwd = await passkeyOnlyProject();

    const { result } = await disablePasskey(["n"], cwd);

    expect(result).toMatchObject({ status: "skipped", reason: "disable-cancelled" });
    expect(await methodOf(cwd, "passkey")).toEqual({ enabled: true });
  });

  it("disables the method and warns when confirmed", async () => {
    const cwd = await passkeyOnlyProject();

    const { result } = await disablePasskey(["y"], cwd);

    expect(result).toMatchObject({
      status: "ok",
      warnings: [
        "default-human-user has no way to sign in left. Its users can only be managed through the API.",
      ],
    });
    expect(await methodOf(cwd, "passkey")).toEqual({ enabled: false });
  });
});

describe("auth-method passkey disable left unanswered", () => {
  it("fails, as every cancelled prompt does", async () => {
    const cwd = await passkeyOnlyProject();

    await expect(disablePasskey([], cwd)).rejects.toThrow();
  });

  it("writes nothing", async () => {
    const cwd = await passkeyOnlyProject();

    await disablePasskey([], cwd).catch(() => undefined);

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

async function disableGoogle(answers: readonly string[], cwd: string) {
  const config = await Config.load({ root: cliPackageRoot });
  return quietly(answers, () =>
    AuthMethodSsoDisable.run(["--provider", "google", "--cwd", cwd, "--no-telemetry"], config),
  );
}

describe("auth-method sso disable confirmation", () => {
  it("asks before removing the last way to sign in", async () => {
    const cwd = await googleOnlyProject();

    const { shown } = await disableGoogle(["n"], cwd);

    expect(shown).toContain(
      "Disable google anyway? Nobody will be able to sign in to default-human-user.",
    );
  });

  it("ends as skipped and writes nothing when declined", async () => {
    const cwd = await googleOnlyProject();

    const { result } = await disableGoogle(["n"], cwd);

    expect(result).toMatchObject({ status: "skipped", reason: "disable-cancelled" });
    expect(await methodOf(cwd, "sso")).toEqual({ enabled: true, providers: ["google"] });
  });

  it("removes the provider and warns when confirmed", async () => {
    const cwd = await googleOnlyProject();

    const { result } = await disableGoogle(["y"], cwd);

    expect(result).toMatchObject({
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

    const { shown } = await disablePasskey([], cwd, "--dry-run");

    expect(shown).not.toContain("Disable passkey anyway?");
  });

  it("previews a dry run, and warns, rather than refusing", async () => {
    const cwd = await passkeyOnlyProject();

    const { result } = await disablePasskey([], cwd, "--dry-run");

    expect(result).toMatchObject({
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

    const { result, shown } = await disablePasskey([], cwd, "--force");

    expect(shown).not.toContain("Disable passkey anyway?");
    expect(result).toMatchObject({ status: "ok" });
  });
});

describe("auth-method passkey disable run from inside the project", () => {
  it("suggests a dry run and a deploy without --cwd", async () => {
    const cwd = await passkeyOnlyProject();
    await writeJson(
      cwd,
      ".zitadel/schemas/default-human-user.json",
      schemaWith({ password: { enabled: true }, passkey: { enabled: true } }),
    );
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const config = await Config.load({ root: cliPackageRoot });

    const { result } = await quietly([], () =>
      AuthMethodPasskeyDisable.run(["--no-telemetry", "--non-interactive"], config),
    );

    expect(result).toMatchObject({
      data: {
        next_args: [
          ["deploy", "--dry-run"],
          ["deploy", "-m", "<what changed>"],
        ],
      },
    });
  });
});

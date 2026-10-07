import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { confirm } from "@clack/prompts";
import { Config } from "@oclif/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AuthFactorDisable from "../../../src/commands/auth-factor/disable";
import { cliPackageRoot } from "../../helpers/oclif-build";

// The confirmation is the guard against locking every user out, so its two
// answers are driven here. The other auth-factor tests run --non-interactive
// against the built CLI, where a prompt cannot be answered.
vi.mock("@clack/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clack/prompts")>()),
  confirm: vi.fn(),
  cancel: vi.fn(),
}));

const tempDirs: string[] = [];
const tty = { stdout: process.stdout.isTTY, stdin: process.stdin.isTTY };

beforeEach(() => {
  // A terminal on both ends is what makes the command interactive.
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
});

afterEach(async () => {
  Object.defineProperty(process.stdout, "isTTY", { value: tty.stdout, configurable: true });
  Object.defineProperty(process.stdin, "isTTY", { value: tty.stdin, configurable: true });
  vi.mocked(confirm).mockReset();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

/** A Project whose only enabled factor is passkey, with no flows to stop the change. */
async function passkeyOnlyProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-auth-factor-confirm-"));
  tempDirs.push(cwd);
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

async function disablePasskey(cwd: string) {
  const config = await Config.load({ root: cliPackageRoot });
  const log = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    return await AuthFactorDisable.run(
      ["--mode", "passkey", "--cwd", cwd, "--no-telemetry"],
      config,
    );
  } finally {
    log.mockRestore();
  }
}

describe("auth-factor disable confirmation", () => {
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

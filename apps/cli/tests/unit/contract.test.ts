import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { COMMANDS } from "../../src/commands/registry";
import { EXIT_CODES } from "../../src/lib/errors";
import { parseJson, runCliForTest } from "../helpers/run-cli";

async function scaffoldNextProject(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-contract-"));
  await mkdir(join(cwd, "app"), { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify({ name: "demo", private: true, dependencies: { next: "^15" } }, null, 2),
  );
  await writeFile(
    join(cwd, "app/layout.tsx"),
    "export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n",
  );
  return cwd;
}

function assertEnvelopeMeta(envelope: Record<string, unknown>): void {
  expect(envelope.cli_version, "cli_version missing").toBeTypeOf("string");
  expect(envelope.command, "command missing").toBeTypeOf("string");
  expect(envelope.source, "source missing").toBeTypeOf("string");
  expect(envelope.status, "status missing").toMatch(/^(ok|skipped|error)$/);
}

describe("envelope contract", () => {
  it("capabilities carries meta and matches the registry", async () => {
    const result = await runCliForTest(["capabilities", "--json"]);
    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as Record<string, unknown>;
    assertEnvelopeMeta(envelope);
    const data = envelope.data as {
      commands: { name: string }[];
      exit_codes: Record<string, number>;
      envelope_schema_version: number;
    };
    expect(data.envelope_schema_version).toBe(1);
    expect(data.exit_codes).toEqual(EXIT_CODES);
    const names = data.commands.map((c) => c.name).sort();
    const registryNames = COMMANDS.map((c) => c.name).sort();
    expect(names).toEqual(registryNames);
  });

  it("help emits meta in JSON mode", async () => {
    const result = await runCliForTest(["help", "--json"]);
    expect(result.exitCode).toBe(0);
    assertEnvelopeMeta(parseJson(result.stdout) as Record<string, unknown>);
  });

  it("help for a specific command emits meta and command details", async () => {
    const result = await runCliForTest(["help", "setup", "--json"]);
    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as { data: { command: { name: string } } } & Record<
      string,
      unknown
    >;
    assertEnvelopeMeta(envelope);
    expect(envelope.data.command.name).toBe("setup");
  });

  it("unknown command errors with meta and next_commands", async () => {
    const result = await runCliForTest(["bogus", "--json"]);
    expect(result.exitCode).toBe(EXIT_CODES.E_VALIDATION);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toMatch(/^\{[\s\S]*\}$/);
    const envelope = parseJson(result.stdout) as {
      status: string;
      code: string;
      next_commands: string[];
    } & Record<string, unknown>;
    assertEnvelopeMeta(envelope);
    expect(envelope.status).toBe("error");
    expect(envelope.code).toBe("E_VALIDATION");
    expect(envelope.next_commands).toContain("zitadel help");
  });

  it("AGENTS.md is the canonical generated contract", async () => {
    const root = join(import.meta.dirname, "../..");
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("Zitadel CLI Agent Contract");
    expect(agents).toContain("zitadel claim status");
    expect(agents).not.toContain("Compatibility note");
  });

  it("bare command in empty dir returns skipped, not error", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-contract-empty-"));
    const result = await runCliForTest(["--cwd", cwd, "--json"]);
    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as {
      status: string;
      reason: string;
      next_commands: string[];
    } & Record<string, unknown>;
    assertEnvelopeMeta(envelope);
    expect(envelope.status).toBe("skipped");
    expect(envelope.reason).toBe("no-framework-detected");
    expect(envelope.next_commands?.length).toBeGreaterThan(0);
  });

  it("version-only resolution defaults to real server, not mock", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-contract-default-"));
    const result = await runCliForTest(["capabilities", "--json", "--cwd", cwd]);
    const envelope = parseJson(result.stdout) as Record<string, unknown>;
    expect(envelope.source).toBe("https://api.zitadel.cloud");
  });

  it("zitadel.json server field takes precedence over default", async () => {
    const cwd = await scaffoldNextProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify(
        {
          $schema: "https://schemas.zitadel.com/v2/project.schema.json",
          project: "existing",
          server: "https://self.example",
        },
        null,
        2,
      ),
    );
    const result = await runCliForTest(["help", "--json", "--cwd", cwd]);
    const envelope = parseJson(result.stdout) as Record<string, unknown>;
    expect(envelope.source).toBe("https://self.example");
  });

  it("status detects orphaned config honestly", async () => {
    const cwd = await scaffoldNextProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify(
        {
          $schema: "https://schemas.zitadel.com/v2/project.schema.json",
          project: "orphan",
          server: "https://api.zitadel.cloud",
        },
        null,
        2,
      ),
    );
    const result = await runCliForTest(["status", "--cwd", cwd, "--json"]);
    expect(result.exitCode).toBe(0);
    const envelope = parseJson(result.stdout) as { status: string; reason: string } & Record<
      string,
      unknown
    >;
    assertEnvelopeMeta(envelope);
    expect(envelope.status).toBe("skipped");
    expect(envelope.reason).toBe("orphaned-config");
  });
});

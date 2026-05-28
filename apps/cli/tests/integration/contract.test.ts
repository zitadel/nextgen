import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

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
  it("a domain command emits envelope meta in JSON mode", async () => {
    const cwd = await scaffoldNextProject();
    const result = await runCliForTest(["status", "--cwd", cwd, "--json"]);
    // Whatever the outcome (a pre-setup project yields an error envelope), the
    // command must speak the envelope — meta fields and a known status.
    assertEnvelopeMeta(parseJson(result.stdout) as Record<string, unknown>);
  });

  it("unknown command is handled by oclif, not the envelope", async () => {
    const result = await runCliForTest(["bogus", "--json"]);
    // oclif's plugin-not-found owns this path: a 127 exit, and crucially no
    // JSON envelope on stdout (the envelope is only for real commands).
    expect(result.exitCode).toBe(127);
    expect(result.stdout.trim()).toBe("");
  });

  it("AGENTS.md is the canonical generated contract", async () => {
    const root = join(import.meta.dirname, "../..");
    const agents = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("Zitadel CLI Agent Contract");
    expect(agents).toContain("zitadel setup");
    expect(agents).not.toContain("Compatibility note");
  });

  it("version-only resolution defaults to real server, not mock", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-contract-default-"));
    const result = await runCliForTest(["status", "--json", "--cwd", cwd]);
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
    const result = await runCliForTest(["status", "--json", "--cwd", cwd]);
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

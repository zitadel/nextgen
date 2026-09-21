import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expectedPublicCliCommand, parseJson, runCliForTest } from "../helpers/run-cli";

// `status` probes POST /users/query on configured projects to stage its guidance.
// Answer with a network error instead of letting the probe hit real DNS for
// the fixtures' fictional hosts — the probe degrades to "unknown" (today's
// lifecycle-only output) without depending on resolver timing.
const server = setupServer(http.post("*/users/query", () => HttpResponse.error()));

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterAll(() => server.close());

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

async function sourceSuggestedCommandIds(dir: string): Promise<Set<string>> {
  const commands = new Set<string>();
  for (const file of await typescriptFiles(dir)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/publicCliCommand\(\s*(["`])([^"`$]*)/g)) {
      const id = commandIdFromArgs(match[2]);
      if (id) commands.add(id);
    }
    for (const match of source.matchAll(/["`]zitadel\s+([a-z][\w:-]*)/g)) {
      commands.add(match[1]);
    }
  }
  return commands;
}

async function typescriptFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await typescriptFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

function commandIdFromArgs(args: string): string | undefined {
  // Leading command words form the id. Topic commands may be suggested in
  // space form ("branding eject") or already colonized ("branding:eject");
  // both normalize to oclif's colon id. Flags and free text end the id.
  const words: string[] = [];
  for (const token of args.trim().split(/\s+/)) {
    if (!/^[a-z][\w:-]*$/.test(token)) break;
    words.push(token);
  }
  return words.length > 0 ? words.join(":") : undefined;
}

describe("suggested-command id extraction", () => {
  it("maps space and colon topic forms to the oclif id and stops at flags", () => {
    expect(commandIdFromArgs("branding eject")).toBe("branding:eject");
    expect(commandIdFromArgs("branding:eject")).toBe("branding:eject");
    expect(commandIdFromArgs("setup --force")).toBe("setup");
    expect(commandIdFromArgs("--force")).toBeUndefined();
  });
});

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

  it("a failing command emits the error envelope in JSON mode", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-contract-err-"));
    const result = await runCliForTest(["apply", "--cwd", cwd, "--json"]);
    expect(result.exitCode).toBe(3);
    const envelope = parseJson(result.stdout) as {
      status: string;
      code: string;
      message: string;
      next_commands?: string[];
    } & Record<string, unknown>;
    assertEnvelopeMeta(envelope);
    expect(envelope.status).toBe("error");
    expect(envelope.code).toBe("E_VALIDATION");
    expect(envelope.message).toBeTypeOf("string");
    expect(envelope.next_commands).toContain(expectedPublicCliCommand("setup"));
  });

  it("renders a human-readable summary (and server suffix) without --json", async () => {
    const cwd = await scaffoldNextProject();
    await writeFile(
      join(cwd, "zitadel.json"),
      JSON.stringify({
        project: "proj-001",
        server: "https://self.example",
        environments: { development: { issuer: "http://localhost:3000" } },
      }),
    );
    await mkdir(join(cwd, ".zitadel"), { recursive: true });
    await writeFile(
      join(cwd, ".zitadel/secret"),
      JSON.stringify({
        project_id: "proj-001",
        project_secret: "sk",
        preview_secret: "sk",
        preview_origins: [],
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    );

    const result = await runCliForTest([
      "status",
      "--cwd",
      cwd,
      "--server",
      "https://self.example",
    ]);
    expect(result.exitCode).toBe(0);
    // Pretty (non-JSON) rendering: the title, the project section, the source
    // suffix for a non-default server, and the next-steps block.
    expect(result.stdout).toContain("Zitadel status.");
    expect(result.stdout).toContain("project=proj-001");
    expect(result.stdout).toContain("(server: self.example)");
    expect(result.stdout).toContain("Next:");
    expect(result.stdout.trim().startsWith("{")).toBe(false);
  });

  it("SKILLS.md is the canonical agent contract", async () => {
    const root = join(import.meta.dirname, "../..");
    const skills = await readFile(join(root, "SKILLS.md"), "utf8");
    expect(skills).toContain("name: zitadel-cli");
    expect(skills).toContain("## Golden path");
    expect(skills).toContain("--non-interactive --json");
    expect(skills).toContain("E_PORT_IN_USE");
    expect(skills).toContain("stop --all");
  });

  it("suggested zitadel next_commands target visible commands", async () => {
    const commands = await runCliForTest(["commands", "--json"]);
    expect(commands.exitCode).toBe(0);
    const visible = new Set(
      (parseJson(commands.stdout) as Array<{ id?: unknown }>)
        .map((command) => command.id)
        .filter((id): id is string => typeof id === "string"),
    );
    const suggested = await sourceSuggestedCommandIds(join(import.meta.dirname, "../../src"));
    expect([...suggested].sort()).toEqual(expect.arrayContaining(["apply", "doctor", "setup"]));
    for (const command of suggested) {
      expect(visible, `${command} should be visible because it appears in next_commands`).toContain(
        command,
      );
    }
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
    const envelope = parseJson(result.stdout) as {
      status: string;
      data: { project: { lifecycle: string } };
    } & Record<string, unknown>;
    assertEnvelopeMeta(envelope);
    expect(envelope.status).toBe("ok");
    expect(envelope.data.project.lifecycle).toBe("orphaned-config");
  });
});

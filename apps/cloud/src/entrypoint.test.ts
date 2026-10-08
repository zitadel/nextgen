import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const ENTRYPOINT = join(import.meta.dirname, "..", "entrypoint.sh");

const PEM = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7",
  "AAAA",
  "-----END PRIVATE KEY-----",
].join("\n");

// Stub server binary: prints argv, the rendered config, and the two env
// vars the entrypoint is responsible for, so one run asserts everything.
const STUB = `#!/bin/sh
printf 'ARGV:%s\\n' "$*"
printf 'ADDRESS:%s\\n' "\${NEXTGEN_SERVER_ADDRESS-unset}"
printf 'DATA_DIR:%s\\n' "\${NEXTGEN_SERVER_DATA_DIR-unset}"
printf 'B64:%s\\n' "\${MASTER_KEY_PEM_B64-unset}"
printf 'CONFIG_BEGIN\\n'
cat "$3"
printf 'CONFIG_END\\n'
`;

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

let work: string;

function run(env: Record<string, string>, ...args: string[]): RunResult {
  const stub = join(work, "nextgen-stub");
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  const result = spawnSync("sh", [ENTRYPOINT, ...args], {
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      NEXTGEN_BIN: stub,
      NEXTGEN_SERVER_DATA_DIR: join(work, "data"),
      ...env,
    },
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "cloud-entrypoint-"));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("entrypoint.sh", () => {
  it("renders the master key into a config file and execs the server with it", () => {
    const out = run({ MASTER_KEY_PEM_B64: b64(PEM), MASTER_KEY_ID: "preview-2026-10" });
    expect(out.status, out.stderr).toBe(0);
    const config = join(work, "data", "nextgen.yaml");
    expect(out.stdout).toContain(`ARGV:server --config ${config}`);
    expect(readFileSync(config, "utf8")).toBe(
      [
        "server:",
        "  generate_master_key: false",
        "  master_keys:",
        "    preview-2026-10:",
        "      use_for_encryption: true",
        "      private_key: |",
        "        -----BEGIN PRIVATE KEY-----",
        "        MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7",
        "        AAAA",
        "        -----END PRIVATE KEY-----",
        "",
      ].join("\n"),
    );
  });

  it("normalises a pasted key: CRLF, surrounding whitespace, blank lines", () => {
    const pasted = `\n   ${PEM.replace(/\n/g, "\r\n")}\r\n\r\n`;
    const out = run({ MASTER_KEY_PEM_B64: b64(pasted) });
    expect(out.status, out.stderr).toBe(0);
    const config = readFileSync(join(work, "data", "nextgen.yaml"), "utf8");
    expect(config).not.toContain("\r");
    expect(config).toContain("    preview:\n");
    expect(config.split("\n").filter((l) => l.startsWith("        "))).toHaveLength(4);
  });

  it("binds the server to Vercel's PORT and drops the key material from the environment", () => {
    const out = run({ MASTER_KEY_PEM_B64: b64(PEM), PORT: "3000" });
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain("ADDRESS::3000");
    expect(out.stdout).toContain(`DATA_DIR:${join(work, "data")}`);
    expect(out.stdout).toContain("B64:unset");
  });

  it("defaults to port 8080 and forwards extra arguments to the server", () => {
    const out = run({ MASTER_KEY_PEM_B64: b64(PEM) }, "--user-file", "/tmp/x.json");
    expect(out.status, out.stderr).toBe(0);
    expect(out.stdout).toContain("ADDRESS::8080");
    expect(out.stdout).toMatch(/ARGV:server --config \S+ --user-file \/tmp\/x\.json/);
  });

  it("refuses to start without key material", () => {
    const out = run({});
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("MASTER_KEY_PEM_B64");
    expect(existsSync(join(work, "data", "nextgen.yaml"))).toBe(false);
  });

  it("refuses key material that is not a PEM block", () => {
    const out = run({ MASTER_KEY_PEM_B64: b64("definitely not a key") });
    expect(out.status).toBe(64);
    expect(out.stderr).toContain("PEM block");
  });

  it("refuses a key id that would not survive as a YAML map key", () => {
    const out = run({ MASTER_KEY_PEM_B64: b64(PEM), MASTER_KEY_ID: "a b" });
    expect(out.status).toBe(64);
    expect(out.stderr).toContain("MASTER_KEY_ID");
  });

  it("renders the platform admin document and passes it as --user-file before other args", () => {
    const doc = JSON.stringify({
      header: { project_id: "proj_platform", id: "user_platformadmin" },
      attributes: { username: "ops@example.com" },
      authenticators: { password: { encoded_hash: "$pbkdf2-sha256$1$a$b" } },
    });
    const out = run(
      { MASTER_KEY_PEM_B64: b64(PEM), BOOTSTRAP_ADMIN_USER_JSON_B64: b64(doc) },
      "--extra",
    );
    expect(out.status, out.stderr).toBe(0);
    const adminFile = join(work, "data", "admin-user.json");
    expect(readFileSync(adminFile, "utf8")).toBe(doc);
    expect(out.stdout).toContain(
      `ARGV:server --config ${join(work, "data", "nextgen.yaml")} --user-file ${adminFile} --extra`,
    );
  });

  it("refuses an admin document that is not a bootstrap user document", () => {
    const out = run({ MASTER_KEY_PEM_B64: b64(PEM), BOOTSTRAP_ADMIN_USER_JSON_B64: b64("{}") });
    expect(out.status).toBe(64);
    expect(out.stderr).toContain("bootstrap user document");
  });
});

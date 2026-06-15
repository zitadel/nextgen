import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const verifyScript = join(repoRoot, "apps/cli-journey-e2e/scripts/verify-tarballs.mjs");
const packageDirs = [
  "apps/cli",
  "packages/api",
  "packages/components",
  "packages/sdk-core",
  "packages/sdk-next",
  "packages/sdk-nuxt",
  "packages/sdk-react",
  "packages/sdk-vue",
  "packages/sdk-angular",
];
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("verify-tarballs script", () => {
  it("accepts installable tarballs with one lockstep alpha version", async () => {
    const tarballsDir = await fixtureTarballs();

    await expect(runVerify(tarballsDir)).resolves.toMatchObject({
      stdout: expect.stringContaining("verified 9 installable tarballs"),
    });
  });

  it("rejects public tarballs with mismatched alpha train versions", async () => {
    const tarballsDir = await fixtureTarballs({
      "@zitadel/sdk-next": "0.1.0-alpha.4",
    });

    await expect(runVerify(tarballsDir)).rejects.toMatchObject({
      stderr: expect.stringContaining("public package tarballs must use one lockstep alpha version"),
    });
  });
});

async function fixtureTarballs(versionOverrides: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zitadel-verify-tarballs-"));
  tempDirs.push(root);
  const tarballsDir = join(root, "tarballs");
  await mkdir(tarballsDir);

  for (const dir of packageDirs) {
    const manifest = JSON.parse(await readFile(join(repoRoot, dir, "package.json"), "utf8")) as {
      name: string;
    };
    const version = versionOverrides[manifest.name] ?? "0.1.0-alpha.5";
    await createTarball(tarballsDir, manifest.name, version);
  }

  return tarballsDir;
}

async function createTarball(tarballsDir: string, name: string, version: string): Promise<void> {
  const workDir = await mkdtemp(join(dirname(tarballsDir), "package-"));
  const packageDir = join(workDir, "package");
  await mkdir(packageDir);
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify({ name, version, license: "MIT" }, null, 2)}\n`,
  );
  const fileName = `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
  await execFile("tar", ["-czf", join(tarballsDir, fileName), "-C", workDir, "package"]);
}

function runVerify(tarballsDir: string) {
  return execFile(process.execPath, [verifyScript, tarballsDir]);
}

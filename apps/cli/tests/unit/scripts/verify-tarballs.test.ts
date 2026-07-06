import { execFile as execFileCallback } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const execFile = promisify(execFileCallback);
const repoRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
const verifyScript = join(repoRoot, "apps/cli-journey-e2e/scripts/verify-tarballs.mjs");
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
  it("accepts installable tarballs with independent package versions", async () => {
    const tarballsDir = await fixtureTarballs({
      "@zitadel/components": "0.2.0-alpha.1",
      "@zitadel/sdk-next": "0.1.0-alpha.4",
    });

    const packageCount = (await publicPackageDirs()).length;
    await expect(runVerify(tarballsDir)).resolves.toMatchObject({
      stdout: expect.stringContaining(`verified ${packageCount} installable tarballs`),
    });
  });

  it("rejects public tarballs with invalid package versions", async () => {
    const tarballsDir = await fixtureTarballs({
      "@zitadel/sdk-next": "workspace:*",
    });

    await expect(runVerify(tarballsDir)).rejects.toMatchObject({
      stderr: expect.stringContaining("public package tarballs must use semver versions"),
    });
  });

  it("rejects server platform tarballs without executable binaries", async () => {
    const tarballsDir = await fixtureTarballs(
      {},
      { nonExecutablePackage: "@zitadel/server-darwin-arm64" },
    );

    await expect(runVerify(tarballsDir)).rejects.toMatchObject({
      stderr: expect.stringContaining("contains non-executable bin/nextgen"),
    });
  });
});

async function fixtureTarballs(
  versionOverrides: Record<string, string> = {},
  options: { nonExecutablePackage?: string } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "zitadel-verify-tarballs-"));
  tempDirs.push(root);
  const tarballsDir = join(root, "tarballs");
  await mkdir(tarballsDir);
  const packageDirs = await publicPackageDirs();

  for (const dir of packageDirs) {
    const manifest = JSON.parse(await readFile(join(repoRoot, dir, "package.json"), "utf8")) as {
      name: string;
    };
    const version = versionOverrides[manifest.name] ?? "0.1.0-alpha.5";
    await createTarball(tarballsDir, manifest.name, version, {
      executable: manifest.name !== options.nonExecutablePackage,
    });
  }

  return tarballsDir;
}

async function publicPackageDirs(): Promise<string[]> {
  const manifest = (await import(
    new URL("../../../../../scripts/release-manifest.mjs", import.meta.url).href
  )) as { PUBLIC_PACKAGE_DIRS: string[] };
  return manifest.PUBLIC_PACKAGE_DIRS;
}

async function createTarball(
  tarballsDir: string,
  name: string,
  version: string,
  options: { executable: boolean },
): Promise<void> {
  const workDir = await mkdtemp(join(dirname(tarballsDir), "package-"));
  const packageDir = join(workDir, "package");
  await mkdir(packageDir);
  const binaryPath = platformBinaryPath(name);
  await writeFile(
    join(packageDir, "package.json"),
    `${JSON.stringify(
      {
        name,
        version,
        license: "MIT",
        ...(binaryPath ? { bin: { nextgen: `./${binaryPath}` } } : {}),
      },
      null,
      2,
    )}\n`,
  );
  if (binaryPath) {
    const absoluteBinaryPath = join(packageDir, binaryPath);
    await mkdir(dirname(absoluteBinaryPath), { recursive: true });
    await writeFile(absoluteBinaryPath, "binary");
    await chmod(absoluteBinaryPath, options.executable ? 0o755 : 0o644);
  }
  const fileName = `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
  await execFile("tar", ["-czf", join(tarballsDir, fileName), "-C", workDir, "package"]);
}

function runVerify(tarballsDir: string) {
  return execFile(process.execPath, [verifyScript, tarballsDir]);
}

function platformBinaryPath(name: string): string | undefined {
  if (!name.startsWith("@zitadel/server-")) {
    return undefined;
  }
  return name.includes("win32") ? "bin/nextgen.exe" : "bin/nextgen";
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

test("setup completed and installed local registry packages", async () => {
  const outputDir = requiredEnv("JOURNEY_OUTPUT_DIR");
  const appDir = requiredEnv("JOURNEY_APP_DIR");

  const setup = JSON.parse(await readFile(join(outputDir, "setup.json"), "utf8"));
  expect(setup.status).toBe("ok");
  expect(setup.cli_version).toEqual(expect.any(String));
  expect(setup.command).toBe("setup");
  expect(setup.source).toEqual(expect.any(String));

  const metadata = JSON.parse(await readFile(join(outputDir, "metadata.json"), "utf8"));
  expect(setup.data.framework).toBe(metadata.framework);
  const packageJson = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
  expect(packageJson.dependencies?.[metadata.sdkPackage]).toBeTruthy();

  await expectLocalLockfileResolution({
    appDir,
    registryUrl: metadata.registryUrl,
    sdkPackage: metadata.sdkPackage,
  });
});

test("doctor detects and repairs managed-file drift", async () => {
  const outputDir = requiredEnv("JOURNEY_OUTPUT_DIR");
  const metadata = JSON.parse(await readFile(join(outputDir, "metadata.json"), "utf8"));
  test.skip(metadata.framework !== "next", "the drift probe runs on the Next suite only");

  type Check = { name: string; status: string };
  const drift = JSON.parse(await readFile(join(outputDir, "doctor-drift.json"), "utf8")) as {
    status: string;
    code: string;
    details?: { checks?: Check[] };
  };
  expect(drift.status).toBe("error");
  expect(drift.code).toBe("E_VALIDATION");
  const driftCheck = (drift.details?.checks ?? []).find((check) => check.name === "managed-files");
  expect(driftCheck?.status).toBe("fail");

  const fix = JSON.parse(await readFile(join(outputDir, "doctor-fix.json"), "utf8")) as {
    status: string;
    data: { ok: boolean; checks?: Check[] };
  };
  expect(fix.status).toBe("ok");
  expect(fix.data.ok).toBe(true);
  expect(
    (fix.data.checks ?? []).find((check) => check.name === "managed-files")?.status,
  ).toBe("pass");
});

async function expectLocalLockfileResolution(input: {
  appDir: string;
  registryUrl: string;
  sdkPackage: string;
}): Promise<void> {
  const packageLockText = await readOptionalFile(join(input.appDir, "package-lock.json"));
  if (packageLockText) {
    expectNpmLockfileResolution({
      lockfile: JSON.parse(packageLockText),
      registryUrl: input.registryUrl,
      sdkPackage: input.sdkPackage,
    });
    return;
  }

  const pnpmLockText = await readOptionalFile(join(input.appDir, "pnpm-lock.yaml"));
  if (pnpmLockText === null) {
    throw new Error("generated app has no supported lockfile");
  }
  expect(pnpmLockText).toContain(input.sdkPackage);
  expect(pnpmLockText).toContain(input.registryUrl);
}

function expectNpmLockfileResolution(input: {
  lockfile: { packages?: Record<string, { resolved?: string }> };
  registryUrl: string;
  sdkPackage: string;
}): void {
  const packageScope = input.sdkPackage.split("/")[0];
  const lockedPackages = Object.entries(input.lockfile.packages ?? {}).filter(([name]) =>
    name.startsWith(`node_modules/${packageScope}/`),
  );
  expect(lockedPackages.length).toBeGreaterThan(0);
  for (const [, entry] of lockedPackages) {
    expect(entry.resolved).toContain(input.registryUrl);
  }
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

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
  const packageJson = JSON.parse(await readFile(join(appDir, "package.json"), "utf8"));
  expect(packageJson.dependencies?.[metadata.sdkNextPackage]).toBeTruthy();

  const packageLock = JSON.parse(await readFile(join(appDir, "package-lock.json"), "utf8"));
  const packageScope = metadata.sdkNextPackage.split("/")[0];
  const lockedPackages = Object.entries(packageLock.packages ?? {}).filter(([name]) =>
    name.startsWith(`node_modules/${packageScope}/`),
  );
  expect(lockedPackages.length).toBeGreaterThan(0);
  for (const [, entry] of lockedPackages) {
    expect((entry as { resolved?: string }).resolved).toContain(metadata.registryUrl);
  }
});

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

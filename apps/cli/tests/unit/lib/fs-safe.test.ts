import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ZitadelError } from "../../../src/lib/errors";
import { appendManagedEnvValue, writeManagedEnvFile } from "../../../src/lib/fs-safe";

async function tmpFile(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zitadel-fs-safe-"));
  return join(dir, ".env.test.local");
}

describe("fs-safe managed env writers", () => {
  it("writeManagedEnvFile serialises key=value lines and creates the file at 0600", async () => {
    const path = await tmpFile();

    await writeManagedEnvFile(path, { ZITADEL_URL: "https://a", ZITADEL_PROJECT_ID: "p1" });

    expect(await readFile(path, "utf8")).toBe("ZITADEL_URL=https://a\nZITADEL_PROJECT_ID=p1\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("appendManagedEnvValue creates the file, then appends without joining the last line", async () => {
    const path = await tmpFile();

    await appendManagedEnvValue(path, "ZITADEL_URL", "https://a");
    await appendManagedEnvValue(path, "ZITADEL_PROJECT_ID", "p1");

    expect(await readFile(path, "utf8")).toBe("ZITADEL_URL=https://a\nZITADEL_PROJECT_ID=p1\n");
  });

  it("refuses a value with a line break as a typed E_VALIDATION error, writing nothing", async () => {
    const path = await tmpFile();

    const appended = appendManagedEnvValue(path, "ZITADEL_PROJECT_SECRET", "a\nb");
    await expect(appended).rejects.toBeInstanceOf(ZitadelError);
    await expect(appended).rejects.toMatchObject({ code: "E_VALIDATION" });
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      writeManagedEnvFile(path, { ZITADEL_PROJECT_SECRET: "line\rbreak" }),
    ).rejects.toBeInstanceOf(ZitadelError);
  });
});

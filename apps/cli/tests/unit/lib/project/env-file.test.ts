import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { parseEnv } from "node:util";

import { describe, expect } from "vitest";

import { Project, ProjectEnvValueError } from "@/lib/project";
import { it } from "@tests/fixtures";

/** The name of the env file each test writes in its directory. */
const ENV_FILE = ".env.test.local";

describe("Project.envFile", () => {
  it("write serialises key=value lines and creates the file at 0600", async ({ dir }) => {
    const path = join(dir, ENV_FILE);

    await Project.envFile(path).write({ ZITADEL_URL: "https://a", ZITADEL_PROJECT_ID: "p1" });

    expect(await readFile(path, "utf8")).toBe("ZITADEL_URL=https://a\nZITADEL_PROJECT_ID=p1\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("append creates the file, then appends without joining the last line", async ({ dir }) => {
    const path = join(dir, ENV_FILE);

    await Project.envFile(path).append("ZITADEL_URL", "https://a");
    await Project.envFile(path).append("ZITADEL_PROJECT_ID", "p1");

    expect(await readFile(path, "utf8")).toBe("ZITADEL_URL=https://a\nZITADEL_PROJECT_ID=p1\n");
  });

  it.for<[string, string]>([
    ["a #", "sk_ab#cd"],
    ["a leading space", " sk_lead"],
    ["a quote", '"sk"'],
    ["an apostrophe and a #", "it's#1"],
  ])("writes a value holding %s so it reads back unchanged", async ([_what, value], { dir }) => {
    const path = join(dir, ENV_FILE);

    await Project.envFile(path).append("ZITADEL_PROJECT_SECRET", value);

    expect(parseEnv(await readFile(path, "utf8")).ZITADEL_PROJECT_SECRET).toBe(value);
  });

  it("keeps a value with an unclosed quote from swallowing the line after it", async ({ dir }) => {
    const path = join(dir, ENV_FILE);

    await Project.envFile(path).write({ ZITADEL_PROJECT_ID: "'p1", ZITADEL_PROJECT_SECRET: "s#1" });

    expect(parseEnv(await readFile(path, "utf8"))).toMatchObject({
      ZITADEL_PROJECT_ID: "'p1",
      ZITADEL_PROJECT_SECRET: "s#1",
    });
  });

  it("refuses a value with a line break as a typed E_VALIDATION error, writing nothing", async ({
    dir,
  }) => {
    const path = join(dir, ENV_FILE);

    const appended = Project.envFile(path).append("ZITADEL_PROJECT_SECRET", "a\nb");
    await expect(appended).rejects.toBeInstanceOf(ProjectEnvValueError);
    await expect(appended).rejects.toMatchObject({
      message: expect.stringContaining("ZITADEL_PROJECT_SECRET"),
    });
    await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    await expect(
      Project.envFile(path).write({ ZITADEL_PROJECT_SECRET: "line\rbreak" }),
    ).rejects.toBeInstanceOf(ProjectEnvValueError);
  });
});

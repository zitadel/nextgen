import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Config } from "@oclif/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CREDENTIALS } from "../../../../src/lib/oclif/credentials";
import { EnvironmentCommand } from "../../../../src/lib/oclif/environment-command";
import { cliPackageRoot } from "../../../helpers/oclif-build";

/** Connects with the project secret, the default credential. */
class ProjectProbe extends EnvironmentCommand {
  async run() {
    const { flags } = await this.parse(ProjectProbe);
    await this.toMeta(flags);
    return { connection: await this.connect(), telemetry: this.telemetryProps };
  }
}

/** Declares the preview token instead, as `zitadel preview` will. */
class PreviewProbe extends EnvironmentCommand {
  static override credential = "preview" as const;

  async run() {
    const { flags } = await this.parse(PreviewProbe);
    await this.toMeta(flags);
    return { connection: await this.connect(), telemetry: this.telemetryProps };
  }
}

let config: Config;
let dir: string;

beforeAll(async () => {
  config = await Config.load(cliPackageRoot);
});

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "zitadel-environment-command-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function envFile(contents: string): Promise<string> {
  const file = join(dir, "staging.env");
  await writeFile(file, contents);
  return file;
}

const URL_AND_PROJECT = "ZITADEL_URL=https://staging.example\nZITADEL_PROJECT_ID=proj_staging\n";

describe("the credentials", () => {
  it("name the variable each one is read from", () => {
    expect(CREDENTIALS).toEqual({
      project: "ZITADEL_PROJECT_SECRET",
      preview: "ZITADEL_PREVIEW_TOKEN",
    });
  });
});

describe("EnvironmentCommand.connect", () => {
  it("authenticates with the project secret unless the command says otherwise", async () => {
    const file = await envFile(`${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);

    const { connection } = await new ProjectProbe(["--cwd", dir, "--env-file", file], config).run();

    expect(connection).toMatchObject({
      projectId: "proj_staging",
      server: "https://staging.example",
    });
  });

  it("names the variable when the credential is missing", async () => {
    const file = await envFile(URL_AND_PROJECT);

    await expect(
      new ProjectProbe(["--cwd", dir, "--env-file", file], config).run(),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("ZITADEL_PROJECT_SECRET"),
    });
  });

  it("does not fall back to the preview token for the project secret", async () => {
    const file = await envFile(`${URL_AND_PROJECT}ZITADEL_PREVIEW_TOKEN=preview_staging\n`);

    await expect(
      new ProjectProbe(["--cwd", dir, "--env-file", file], config).run(),
    ).rejects.toMatchObject({ message: expect.stringContaining("ZITADEL_PROJECT_SECRET") });
  });

  it("does not fall back to the project secret for the preview token", async () => {
    const file = await envFile(`${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);

    await expect(
      new PreviewProbe(["--cwd", dir, "--env-file", file], config).run(),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("ZITADEL_PREVIEW_TOKEN"),
    });
  });

  it("connects with the preview token when that is the credential declared", async () => {
    const file = await envFile(`${URL_AND_PROJECT}ZITADEL_PREVIEW_TOKEN=preview_staging\n`);

    const { connection } = await new PreviewProbe(["--cwd", dir, "--env-file", file], config).run();

    expect(connection.projectId).toBe("proj_staging");
  });

  it("names the server when there is none", async () => {
    const file = await envFile("ZITADEL_PROJECT_ID=proj_staging\nZITADEL_PROJECT_SECRET=sk\n");

    await expect(
      new ProjectProbe(["--cwd", dir, "--env-file", file], config).run(),
    ).rejects.toMatchObject({ message: expect.stringContaining("ZITADEL_URL") });
  });

  it("records the credential kind and that a file was used, never its name", async () => {
    const file = await envFile(`${URL_AND_PROJECT}ZITADEL_PREVIEW_TOKEN=preview_staging\n`);

    const { telemetry } = await new PreviewProbe(["--cwd", dir, "--env-file", file], config).run();

    expect(telemetry).toEqual({ credential: "preview", has_env_file: true });
  });

  it("records that no file was used when there was none", async () => {
    await writeFile(
      join(dir, ".env.development.local"),
      `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk\n`,
    );

    const { telemetry } = await new ProjectProbe(["--cwd", dir], config).run();

    expect(telemetry).toEqual({ credential: "project", has_env_file: false });
  });
});

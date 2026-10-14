import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { password, text } from "@clack/prompts";
import { Config } from "@oclif/core";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { CREDENTIALS } from "../../../../src/lib/oclif/credentials";
import { EnvironmentCommand, PreviewCommand } from "../../../../src/lib/oclif/environment-command";
import { cliPackageRoot } from "../../../helpers/oclif-build";
import { asTerminal } from "../../../helpers/terminal";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

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

/** A real preview command's base, connecting as `preview list` does. */
class PreviewCommandProbe extends PreviewCommand {
  async run() {
    const { flags } = await this.parse(PreviewCommandProbe);
    await this.toMeta(flags);
    return { connection: await this.connect() };
  }
}

/** Exposes the selector suffix the base class derives from the resolution. */
class SelectorProbe extends EnvironmentCommand {
  async run() {
    const { flags } = await this.parse(SelectorProbe);
    await this.toMeta(flags);
    return { selector: this.environmentSelector() };
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

  it("never asks for a missing value on a dry run, even on a terminal", async () => {
    const file = await envFile(URL_AND_PROJECT);

    await expect(
      asTerminal(() =>
        new ProjectProbe(["--cwd", dir, "--env-file", file, "--dry-run"], config).run(),
      ),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
    expect(vi.mocked(text)).not.toHaveBeenCalled();
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

describe("EnvironmentCommand.environmentSelector", () => {
  it("is empty when no selector flag was passed", async () => {
    const { selector } = await new SelectorProbe([], config).run();

    expect(selector).toBe("");
  });

  it("reflects --cwd, which the other flags resolve against", async () => {
    const { selector } = await new SelectorProbe(["--cwd", dir], config).run();

    expect(selector).toBe(` --cwd ${dir}`);
  });

  it("reflects a non-default --env", async () => {
    const { selector } = await new SelectorProbe(["--cwd", dir, "--env", "staging"], config).run();

    expect(selector).toBe(` --env staging --cwd ${dir}`);
  });

  it("reflects --env-file", async () => {
    const file = await envFile(URL_AND_PROJECT);

    const { selector } = await new SelectorProbe(["--cwd", dir, "--env-file", file], config).run();

    expect(selector).toBe(` --env-file ${file} --cwd ${dir}`);
  });

  it("reflects --server as the resolved origin", async () => {
    const { selector } = await new SelectorProbe(
      ["--cwd", dir, "--server", "https://staging.example"],
      config,
    ).run();

    expect(selector).toBe(` --server https://staging.example --cwd ${dir}`);
  });
});

describe("PreviewCommand.connect", () => {
  it("fails on a terminal rather than asking for a missing preview token", async () => {
    const file = await envFile(URL_AND_PROJECT);

    await expect(
      asTerminal(() => new PreviewCommandProbe(["--cwd", dir, "--env-file", file], config).run()),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
    expect(text).not.toHaveBeenCalled();
    expect(password).not.toHaveBeenCalled();
  });
});

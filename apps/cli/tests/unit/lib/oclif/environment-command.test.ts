import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { password, text } from "@clack/prompts";
import { Config } from "@oclif/core";
import { describe, expect, vi } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { connectionOf, REQUEST_TIMEOUT_MS } from "@/lib/backend/client";
import { CREDENTIALS } from "@/lib/oclif/credentials";
import { EnvironmentCommand, PreviewCommand } from "@/lib/oclif/environment-command";
import type { ConnectOptions } from "@/lib/oclif/types";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { asTerminal } from "@tests/helpers/terminal";

vi.mock("@clack/prompts", async () => (await import("@tests/helpers/clack")).clackDouble());

/** Connects with the project secret, the default credential. */
class ProjectProbe extends EnvironmentCommand {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe() {
    const { flags } = await this.parse(ProjectProbe);
    await this.toMeta(flags);
    return { connection: await this.connect(), telemetry: this.telemetryProps };
  }
}

/** Connects with the options it is given, as a best-effort probe does. */
class OptionedProbe extends EnvironmentCommand {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe(options: ConnectOptions) {
    const { flags } = await this.parse(OptionedProbe);
    await this.toMeta(flags);
    return this.connect(options);
  }
}

/** Connects more than once, as a command that probes before it works does. */
class RepeatedProbe extends EnvironmentCommand {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe(...asked: ReadonlyArray<{ quiet?: boolean; prompt?: boolean }>) {
    const { flags } = await this.parse(RepeatedProbe);
    await this.toMeta(flags);
    const opened = [];
    for (const options of asked) {
      opened.push(await this.connect(options).catch((error: unknown) => error));
    }
    return opened;
  }
}

/** Declares the preview token instead, as `zitadel preview` will. */
class PreviewProbe extends EnvironmentCommand {
  static override credential = "preview" as const;

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe() {
    const { flags } = await this.parse(PreviewProbe);
    await this.toMeta(flags);
    return { connection: await this.connect(), telemetry: this.telemetryProps };
  }
}

/** A real preview command's base, connecting as `preview list` does. */
class PreviewCommandProbe extends PreviewCommand {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe() {
    const { flags } = await this.parse(PreviewCommandProbe);
    await this.toMeta(flags);
    return { connection: await this.connect() };
  }
}

/** Exposes the selector suffix the base class derives from the resolution. */
class SelectorProbe extends EnvironmentCommand {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe() {
    const { flags } = await this.parse(SelectorProbe);
    await this.toMeta(flags);
    return { selector: this.environmentSelector() };
  }
}

const config = await Config.load(cliPackageRoot);

async function envFile(dir: string, contents: string): Promise<string> {
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
  it("authenticates with the project secret unless the command says otherwise", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);

    const { connection } = await new ProjectProbe(
      ["--cwd", dir, "--env-file", file],
      config,
    ).probe();

    expect(connection).toMatchObject({
      projectId: "proj_staging",
      server: "https://staging.example",
    });
  });

  it("opens one connection however the same options were written", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);

    const opened = await new RepeatedProbe(["--cwd", dir, "--env-file", file], config).probe(
      { quiet: true, prompt: false },
      { prompt: false, quiet: true },
    );

    expect(opened[0]).toBe(opened[1]);
  });

  it("gives a probe's connection the deadline it asked for, so its request is given up on", async ({
    dir,
  }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);

    const connection = await new OptionedProbe(["--cwd", dir, "--env-file", file], config).probe({
      quiet: true,
      prompt: false,
      timeoutMs: 1500,
    });

    expect(connectionOf(connection.client).timeoutMs).toBe(1500);
  });

  it("leaves a connection nobody hurried on the default deadline", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);

    const connection = await new OptionedProbe(["--cwd", dir, "--env-file", file], config).probe({
      quiet: true,
    });

    expect(connectionOf(connection.client).timeoutMs).toBe(REQUEST_TIMEOUT_MS);
  });

  it("forgets a connection that failed, so a second attempt is made", async ({ dir }) => {
    const file = await envFile(dir, URL_AND_PROJECT);

    const opened = await new RepeatedProbe(["--cwd", dir, "--env-file", file], config).probe(
      { prompt: false },
      { prompt: false },
    );

    expect(opened[0]).not.toBe(opened[1]);
    expect(opened[0]).toMatchObject({ code: "E_VALIDATION" });
    expect(opened[1]).toMatchObject({ code: "E_VALIDATION" });
  });

  it("names the variable when the credential is missing", async ({ dir }) => {
    const file = await envFile(dir, URL_AND_PROJECT);

    await expect(
      new ProjectProbe(["--cwd", dir, "--env-file", file], config).probe(),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("ZITADEL_PROJECT_SECRET"),
    });
  });

  it("never asks for a missing value on a dry run, even on a terminal", async ({ dir }) => {
    const file = await envFile(dir, URL_AND_PROJECT);

    await expect(
      asTerminal(() =>
        new ProjectProbe(["--cwd", dir, "--env-file", file, "--dry-run"], config).probe(),
      ),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
    expect(vi.mocked(text)).not.toHaveBeenCalled();
  });

  it("does not fall back to the preview token for the project secret", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PREVIEW_TOKEN=preview_staging\n`);

    await expect(
      new ProjectProbe(["--cwd", dir, "--env-file", file], config).probe(),
    ).rejects.toMatchObject({ message: expect.stringContaining("ZITADEL_PROJECT_SECRET") });
  });

  it("does not fall back to the project secret for the preview token", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);

    await expect(
      new PreviewProbe(["--cwd", dir, "--env-file", file], config).probe(),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("ZITADEL_PREVIEW_TOKEN"),
    });
  });

  it("connects with the preview token when that is the credential declared", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PREVIEW_TOKEN=preview_staging\n`);

    const { connection } = await new PreviewProbe(
      ["--cwd", dir, "--env-file", file],
      config,
    ).probe();

    expect(connection.projectId).toBe("proj_staging");
  });

  it("names the server when there is none", async ({ dir }) => {
    const file = await envFile(dir, "ZITADEL_PROJECT_ID=proj_staging\nZITADEL_PROJECT_SECRET=sk\n");

    await expect(
      new ProjectProbe(["--cwd", dir, "--env-file", file], config).probe(),
    ).rejects.toMatchObject({ message: expect.stringContaining("ZITADEL_URL") });
  });

  it("records the credential kind and that a file was used, never its name", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PREVIEW_TOKEN=preview_staging\n`);

    const { telemetry } = await new PreviewProbe(
      ["--cwd", dir, "--env-file", file],
      config,
    ).probe();

    expect(telemetry).toEqual({ credential: "preview", has_env_file: true });
  });

  it("records that no file was used when there was none", async ({ dir }) => {
    await writeFile(
      join(dir, ".env.development.local"),
      `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk\n`,
    );

    const { telemetry } = await new ProjectProbe(["--cwd", dir], config).probe();

    expect(telemetry).toEqual({ credential: "project", has_env_file: false });
  });
});

describe("EnvironmentCommand.environmentSelector", () => {
  it("is empty when no selector flag was passed", async () => {
    const { selector } = await new SelectorProbe([], config).probe();

    expect(selector).toBe("");
  });

  it("reflects --cwd, which the other flags resolve against", async ({ dir }) => {
    const { selector } = await new SelectorProbe(["--cwd", dir], config).probe();

    expect(selector).toBe(` --cwd ${dir}`);
  });

  it("reflects a non-default --env", async ({ dir }) => {
    const { selector } = await new SelectorProbe(
      ["--cwd", dir, "--env", "staging"],
      config,
    ).probe();

    expect(selector).toBe(` --env staging --cwd ${dir}`);
  });

  it("reflects --env-file", async ({ dir }) => {
    const file = await envFile(dir, URL_AND_PROJECT);

    const { selector } = await new SelectorProbe(
      ["--cwd", dir, "--env-file", file],
      config,
    ).probe();

    expect(selector).toBe(` --env-file ${file} --cwd ${dir}`);
  });

  it("reflects --server as the resolved origin", async ({ dir }) => {
    const { selector } = await new SelectorProbe(
      ["--cwd", dir, "--server", "https://staging.example"],
      config,
    ).probe();

    expect(selector).toBe(` --server https://staging.example --cwd ${dir}`);
  });
});

describe("PreviewCommand.connect", () => {
  it("fails on a terminal rather than asking for a missing preview token", async ({ dir }) => {
    const file = await envFile(dir, URL_AND_PROJECT);

    await expect(
      asTerminal(() => new PreviewCommandProbe(["--cwd", dir, "--env-file", file], config).probe()),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
    expect(text).not.toHaveBeenCalled();
    expect(password).not.toHaveBeenCalled();
  });
});

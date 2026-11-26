import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { password, text } from "@clack/prompts";
import { Config } from "@oclif/core";
import { describe, expect, onTestFinished, vi } from "vitest";

import { it } from "@tests/fixtures";

import { connectionOf, REQUEST_TIMEOUT_MS } from "@/lib/backend/client";
import type { ZitadelClient } from "@/lib/backend";
import { Consent } from "@/lib/consent";
import { EnvironmentValueMissingError, type ServerAddresses } from "@/lib/environment";
import { LocalServerRecordMalformedError, ZitadelRuntime } from "@/lib/server";
import { ZitadelError } from "@/lib/errors";
import { CREDENTIALS } from "@/cli/core/credentials";
import { EnvironmentCommand, PreviewCommand } from "@/cli/core/environment-command";
import type { ConnectOptions } from "@/cli/core/types";
import { cliPackageRoot } from "@tests/helpers/oclif-build";
import { asTerminal } from "@tests/fixtures/terminal";
import { Previewable } from "@/cli/core/previewable";
import { ServerCommand } from "@/cli/commands/server-command";

vi.mock("@clack/prompts", async () => (await import("@tests/helpers/clack")).clackDouble());

/** Connects with the project secret, the default credential. */
class ProjectProbe extends ServerCommand(EnvironmentCommand) {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  override log(): void {}

  async probe() {
    const { flags } = await this.parse(ProjectProbe);
    await this.toMeta(flags);
    return { connection: await this.connect(), telemetry: this.describe() };
  }
}

/** Resolves its server from a local record that is malformed. */
class MalformedRecordProbe extends ServerCommand(EnvironmentCommand) {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  override log(): void {}

  protected override servers(): ServerAddresses {
    return {
      resolve: () => {
        return Promise.reject(new LocalServerRecordMalformedError("the record is malformed"));
      },
      parse: (value) => {
        return ZitadelRuntime.parse(value);
      },
      origin: (value) => {
        return ZitadelRuntime.origin(value);
      },
    };
  }

  async probe() {
    const { flags } = await this.parse(MalformedRecordProbe);
    await this.toMeta(flags);
  }
}

/** Connects with the project secret as a command that changes something does, so it has a dry run. */
class DryRunProbe extends Previewable(ServerCommand(EnvironmentCommand)) {
  protected async preview(): Promise<never> {
    throw new Error("unused");
  }

  protected async apply(): Promise<never> {
    throw new Error("unused");
  }

  async probe() {
    const { flags } = await this.parse(DryRunProbe);
    await this.toMeta(flags);
    return { connection: await this.connect() };
  }
}

/** Connects with the options it is given, as a best-effort probe does. */
class OptionedProbe extends ServerCommand(EnvironmentCommand) {
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
class RepeatedProbe extends ServerCommand(EnvironmentCommand) {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe(...asked: ReadonlyArray<{ timeoutMs?: number; prompt?: boolean }>) {
    const { flags } = await this.parse(RepeatedProbe);
    await this.toMeta(flags);
    const opened = [];
    for (const options of asked) {
      opened.push(await this.connect(options).catch((error: unknown) => error));
    }
    return opened;
  }
}

/** A service as the backend builds one: from the client and the project's id. */
class Built {
  /** The client the service was built from. */
  readonly client: ZitadelClient;

  /** The project the service was built for. */
  readonly projectId: string;

  /**
   * @param client - The client the service talks through.
   * @param projectId - The project it acts on.
   */
  constructor(client: ZitadelClient, projectId: string) {
    this.client = client;
    this.projectId = projectId;
  }
}

/** Builds services and names the project the way a command's question does. */
class ServiceProbe extends ServerCommand(EnvironmentCommand) {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  /**
   * Builds a service plainly and with a consent, and names the project.
   *
   * @param consent - The consent that unlocks the client for the second service.
   * @returns What was built and the connection it was built on.
   */
  async probe(consent: Consent) {
    const { flags } = await this.parse(ServiceProbe);
    await this.toMeta(flags);
    const connection = await this.connect();

    return {
      connection,
      plain: await this.service(Built),
      consented: await this.service(Built, consent),
      unlocked: consent.unlock(connection.client),
      phrase: await this.projectOnServer(),
    };
  }
}

/** Declares the preview token instead, as `zitadel preview` will. */
class PreviewProbe extends ServerCommand(EnvironmentCommand) {
  static override credential = "preview" as const;

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  override log(): void {}

  async probe() {
    const { flags } = await this.parse(PreviewProbe);
    await this.toMeta(flags);
    return { connection: await this.connect(), telemetry: this.describe() };
  }
}

/** A real preview command's base, connecting as `preview list` does. */
class PreviewCommandProbe extends ServerCommand(PreviewCommand) {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe() {
    const { flags } = await this.parse(PreviewCommandProbe);
    await this.toMeta(flags);
    return { connection: await this.connect() };
  }
}

/** Exposes the scope the base class derives from the resolution. */
class SelectorProbe extends ServerCommand(EnvironmentCommand) {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe() {
    const { flags } = await this.parse(SelectorProbe);
    await this.toMeta(flags);
    return { scope: this.scope() };
  }
}

/** A command that edits files only, so it resolves no environment. */
class FilesOnlyProbe extends ServerCommand(EnvironmentCommand) {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe() {
    const { flags } = await this.parse(FilesOnlyProbe);
    await this.toMeta(flags, { environment: false });
    return { scope: this.scope() };
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

describe("EnvironmentCommand.service", () => {
  it("builds the service from the connection's client and the project's id", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);
    const consent = await Consent.request(
      { verb: "remove", name: "remove it", message: "Remove it?" },
      { interactive: false, force: true, dryRun: false },
    );
    if (consent === undefined) {
      throw new Error("consent was not given");
    }

    const { connection, plain } = await new ServiceProbe(
      ["--cwd", dir, "--env-file", file],
      config,
    ).probe(consent);

    expect(plain.client).toBe(connection.client);
    expect(plain.projectId).toBe("proj_staging");
  });

  it("builds it from the unlocked client when a consent is given", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);
    const consent = await Consent.request(
      { verb: "remove", name: "remove it", message: "Remove it?" },
      { interactive: false, force: true, dryRun: false },
    );
    if (consent === undefined) {
      throw new Error("consent was not given");
    }

    const { connection, consented, unlocked } = await new ServiceProbe(
      ["--cwd", dir, "--env-file", file],
      config,
    ).probe(consent);

    expect(Object.is(consented.client, unlocked)).toBe(true);
    expect(Object.is(consented.client, connection.client)).toBe(false);
  });
});

describe("EnvironmentCommand.projectOnServer", () => {
  it("names the project and the server without its scheme", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);
    const consent = await Consent.request(
      { verb: "remove", name: "remove it", message: "Remove it?" },
      { interactive: false, force: true, dryRun: false },
    );
    if (consent === undefined) {
      throw new Error("consent was not given");
    }

    const { phrase } = await new ServiceProbe(["--cwd", dir, "--env-file", file], config).probe(
      consent,
    );

    expect(phrase).toBe("project proj_staging on staging.example");
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
      { timeoutMs: 1000, prompt: false },
      { prompt: false, timeoutMs: 1000 },
    );

    expect(opened[0]).toBe(opened[1]);
  });

  it("gives a probe's connection the deadline it asked for, so its request is given up on", async ({
    dir,
  }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);

    const connection = await new OptionedProbe(["--cwd", dir, "--env-file", file], config).probe({
      prompt: false,
      timeoutMs: 1500,
    });

    expect(connectionOf(connection.client).timeoutMs).toBe(1500);
  });

  it("leaves a connection nobody hurried on the default deadline", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);

    const connection = await new OptionedProbe(["--cwd", dir, "--env-file", file], config).probe(
      {},
    );

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

  it("points a development environment with no project at setup", async ({ dir }) => {
    await expect(new ProjectProbe(["--cwd", dir], config).probe()).rejects.toMatchObject({
      nextCommands: [
        {
          id: "setup",
          flags: {
            cwd: dir,
          },
        },
      ],
    });
  });

  it("points any other environment with no project at env add, run in the directory it addressed", async ({
    dir,
  }) => {
    await expect(
      new ProjectProbe(["--cwd", dir, "--env", "staging"], config).probe(),
    ).rejects.toMatchObject({
      nextCommands: [
        {
          id: "env:add",
          args: {
            name: "staging",
          },
          flags: {
            cwd: dir,
          },
        },
      ],
    });
  });

  it.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "refuses a malformed record even when no folder above can be read",
    async ({ dir }) => {
      const locked = join(dir, "locked");
      await mkdir(join(locked, "inner"), { recursive: true });
      await chmod(locked, 0o000);
      onTestFinished(async () => {
        await chmod(locked, 0o700);
      });

      await expect(
        new MalformedRecordProbe(
          ["--cwd", join(locked, "inner"), "--server", "local"],
          config,
        ).probe(),
      ).rejects.toBeInstanceOf(ZitadelError);
    },
  );

  it("points an --env-file run at that file and never at setup", async ({ dir }) => {
    await writeFile(join(dir, "ci.env"), "ZITADEL_URL=https://ci.example\n");

    await expect(
      new ProjectProbe(["--cwd", dir, "--env-file", join(dir, "ci.env")], config).probe(),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof EnvironmentValueMissingError &&
        error.message.includes("Set ZITADEL_PROJECT_ID in")
      );
    });
  });

  it("points an environment env add already bound at its own file", async ({ dir }) => {
    await writeFile(
      join(dir, ".env.production.local"),
      "ZITADEL_URL=https://production.example\nZITADEL_PROJECT_ID=proj_production\n",
    );

    await expect(
      new ProjectProbe(["--cwd", dir, "--env", "production"], config).probe(),
    ).rejects.toSatisfy((error: unknown) => {
      return (
        error instanceof EnvironmentValueMissingError &&
        error.message.includes("Set ZITADEL_PROJECT_SECRET in .env.production.local")
      );
    });
  });

  it("sends no one to env add when the process environment already names the project", async ({
    dir,
  }) => {
    await writeFile(join(dir, ".env.production.local"), "ZITADEL_URL=https://production.example\n");
    vi.stubEnv("ZITADEL_PROJECT_ID", "proj_ci");

    await expect(
      new ProjectProbe(["--cwd", dir, "--env", "production"], config).probe(),
    ).rejects.toBeInstanceOf(EnvironmentValueMissingError);
  });

  it("never asks for a missing value on a dry run, even on a terminal", async ({ dir }) => {
    const file = await envFile(dir, URL_AND_PROJECT);

    await expect(
      asTerminal(() =>
        new DryRunProbe(["--cwd", dir, "--env-file", file, "--dry-run"], config).probe(),
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

    expect(telemetry).toEqual({
      credential: "preview",
      has_env_file: true,
    });
  });

  it("records that no file was used when there was none", async ({ dir }) => {
    await writeFile(
      join(dir, ".env.development.local"),
      `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk\n`,
    );

    const { telemetry } = await new ProjectProbe(["--cwd", dir], config).probe();

    expect(telemetry).toEqual({
      credential: "project",
      has_env_file: false,
    });
  });
});

describe("EnvironmentCommand.scope", () => {
  it("is empty when no selector flag was passed", async () => {
    const { scope } = await new SelectorProbe([], config).probe();

    expect(scope).toEqual({});
  });

  it("reflects --cwd, which the other flags resolve against", async ({ dir }) => {
    const { scope } = await new SelectorProbe(["--cwd", dir], config).probe();

    expect(scope).toEqual({ cwd: dir });
  });

  it("reflects a non-default --env", async ({ dir }) => {
    const { scope } = await new SelectorProbe(["--cwd", dir, "--env", "staging"], config).probe();

    expect(scope).toEqual({ cwd: dir, env: "staging" });
  });

  it("reflects --env-file in place of the environment's name", async ({ dir }) => {
    const file = await envFile(dir, URL_AND_PROJECT);

    const { scope } = await new SelectorProbe(["--cwd", dir, "--env-file", file], config).probe();

    expect(scope).toEqual({ cwd: dir, envFile: file });
  });

  it("keeps only --cwd in a command that resolved no environment", async ({ dir }) => {
    const { scope } = await new FilesOnlyProbe(["--cwd", dir], config).probe();

    expect(scope).toEqual({ cwd: dir });
  });

  it("reflects --server as the resolved origin", async ({ dir }) => {
    const { scope } = await new SelectorProbe(
      ["--cwd", dir, "--server", "https://staging.example"],
      config,
    ).probe();

    expect(scope).toEqual({ cwd: dir, server: "https://staging.example" });
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

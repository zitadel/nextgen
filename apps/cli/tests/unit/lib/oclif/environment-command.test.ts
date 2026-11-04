import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { password, text } from "@clack/prompts";
import { Config } from "@oclif/core";
import { consola } from "consola";
import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, vi } from "vitest";

import { it } from "../../../helpers/fixtures";

import { ZitadelError } from "../../../../src/lib/errors";
import { CREDENTIALS, registerSignInLookup } from "../../../../src/lib/oclif/credentials";
import { EnvironmentCommand, PreviewCommand } from "../../../../src/lib/oclif/environment-command";
import { cliPackageRoot } from "../../../helpers/oclif-build";
import { asTerminal } from "../../../helpers/terminal";

vi.mock("@clack/prompts", async () => (await import("../../../helpers/clack")).clackDouble());

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
    return {
      selector: this.environmentSelector(),
      retry: this.retryCommand(["deploy", "--credential", "login", "-m", "fix"]),
    };
  }
}

/** Connects, then ends the run as a command does, so its envelope can be read. */
class EmittingProbe extends EnvironmentCommand {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  async probe(connecting = true) {
    const { flags } = await this.parse(EmittingProbe);
    await this.toMeta(flags);
    if (connecting) {
      await this.connect();
    }
    return this.emit({ status: "ok", data: {}, pretty: "" });
  }
}

const config = await Config.load(cliPackageRoot);

async function envFile(dir: string, contents: string): Promise<string> {
  const file = join(dir, "staging.env");
  await writeFile(file, contents);
  return file;
}

const URL_AND_PROJECT = "ZITADEL_URL=https://staging.example\nZITADEL_PROJECT_ID=proj_staging\n";

/** The server {@link URL_AND_PROJECT} names. */
const SERVER = "https://staging.example";

/** The sign-in a fake `zitadel login` keeps for {@link SERVER}. */
const SIGNED_IN = { token: "login_token", who: "dev@acme.com" };

/** Signs the developer in to {@link SERVER}, and records each server a run looked one up for. */
function signedIn(): { lookups: string[] } {
  const lookups: string[] = [];
  registerSignInLookup(async (server) => {
    lookups.push(server);
    return server === SERVER ? SIGNED_IN : undefined;
  });
  return { lookups };
}

/** Nobody is signed in, and every run's look is recorded. */
function nobodySignedIn(): { lookups: string[] } {
  const lookups: string[] = [];
  registerSignInLookup(async (server) => {
    lookups.push(server);
    return undefined;
  });
  return { lookups };
}

afterEach(() => {
  registerSignInLookup(async () => undefined);
});

/** The server, project and secret, written to one of the files setup keeps for development. */
async function storedBySetup(dir: string, file: string): Promise<void> {
  if (file === ".zitadel/secret") {
    await writeFile(join(dir, ".env.local"), "ZITADEL_URL=https://staging.example\n");
    await mkdir(join(dir, ".zitadel"), { recursive: true });
    await writeFile(
      join(dir, ".zitadel/secret"),
      JSON.stringify({
        project_id: "proj_staging",
        project_secret: "sk_setup",
        preview_secret: "pk_setup",
        primary_origins: [],
        preview_origins: [],
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    );
    return;
  }
  await writeFile(join(dir, file), `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_setup\n`);
}

/** The files setup keeps the development environment's secret in. */
const SETUP_FILES = [
  ".env.local",
  ".env.development.local",
  ".env.development",
  ".env",
  ".zitadel/secret",
];

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

describe("the credential a run connects with", () => {
  it("is a secret the process environment names, ahead of your sign-in", async ({ dir }) => {
    await writeFile(join(dir, ".env.development.local"), URL_AND_PROJECT);
    vi.stubEnv("ZITADEL_PROJECT_SECRET", "sk_env");
    const { lookups } = signedIn();

    const { connection } = await new ProjectProbe(["--cwd", dir], config).probe();

    expect(connection.credential).toBe("project");
    expect(lookups).toEqual([]);
  });

  it("is a secret --env-file names, ahead of your sign-in", async ({ dir }) => {
    const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);
    signedIn();

    const { connection } = await new ProjectProbe(
      ["--cwd", dir, "--env-file", file],
      config,
    ).probe();

    expect(connection.credential).toBe("project");
  });

  it("is a secret the files of a chosen environment hold, ahead of your sign-in", async ({
    dir,
  }) => {
    await writeFile(
      join(dir, ".env.staging.local"),
      `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`,
    );
    signedIn();

    const { connection } = await new ProjectProbe(
      ["--cwd", dir, "--env", "staging"],
      config,
    ).probe();

    expect(connection.credential).toBe("project");
  });

  it.for(SETUP_FILES)(
    "is your sign-in, ahead of the secret setup stored in %s",
    async (file, { dir }) => {
      await storedBySetup(dir, file);
      signedIn();

      const { connection } = await new ProjectProbe(["--cwd", dir], config).probe();

      expect(connection.credential).toBe("login");
    },
  );

  it.for(SETUP_FILES)(
    "is the secret setup stored in %s while nobody is signed in",
    async (file, { dir }) => {
      await storedBySetup(dir, file);
      nobodySignedIn();

      const { connection } = await new ProjectProbe(["--cwd", dir], config).probe();

      expect(connection.credential).toBe("project");
    },
  );

  it("is your sign-in when no secret resolves at all", async ({ dir }) => {
    await writeFile(join(dir, ".env.development.local"), URL_AND_PROJECT);
    signedIn();

    const { connection } = await new ProjectProbe(["--cwd", dir], config).probe();

    expect(connection.credential).toBe("login");
  });

  it("looks for a sign-in at the run's own server", async ({ dir }) => {
    await writeFile(join(dir, ".env.development.local"), URL_AND_PROJECT);
    const { lookups } = signedIn();

    await new ProjectProbe(["--cwd", dir], config).probe();

    expect(lookups).toEqual([SERVER]);
  });

  it("is chosen once for every connection a run opens", async ({ dir }) => {
    await storedBySetup(dir, ".env.local");
    const { lookups } = signedIn();

    await new RepeatedProbe(["--cwd", dir], config).probe({ quiet: true }, {});

    expect(lookups).toHaveLength(1);
  });

  it("names the variable and zitadel login when neither resolves", async ({ dir }) => {
    await writeFile(join(dir, ".env.development.local"), URL_AND_PROJECT);
    nobodySignedIn();

    await expect(new ProjectProbe(["--cwd", dir], config).probe()).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("ZITADEL_PROJECT_SECRET"),
      hint: expect.stringContaining(`zitadel login --server ${SERVER}`),
    });
  });

  it("says on a terminal whom it acts as", async ({ dir }) => {
    await storedBySetup(dir, ".env.local");
    signedIn();
    const info = vi.spyOn(consola, "info").mockImplementation(() => undefined);

    await asTerminal(() => new ProjectProbe(["--cwd", dir], config).probe());

    expect(info).toHaveBeenCalledWith(`As        ${SIGNED_IN.who}`);
  });

  it("records your sign-in as the credential once it acted as you", async ({ dir }) => {
    await storedBySetup(dir, ".env.local");
    signedIn();

    const { telemetry } = await new ProjectProbe(["--cwd", dir], config).probe();

    expect(telemetry).toEqual({ credential: "login", has_env_file: false });
  });

  it("names the credential it connected with in the envelope", async ({ dir }) => {
    await storedBySetup(dir, ".env.local");
    signedIn();

    const envelope = await new EmittingProbe(["--cwd", dir], config).probe();

    expect(envelope).toMatchObject({ source: SERVER, credential: "login" });
  });

  it("names no credential in the envelope of a run that did not connect", async ({ dir }) => {
    await storedBySetup(dir, ".env.local");
    signedIn();

    const envelope = await new EmittingProbe(["--cwd", dir], config).probe(false);

    expect(envelope).not.toHaveProperty("credential");
  });

  describe("after a refusal", () => {
    it("is not the stored secret when your sign-in can no longer be refreshed", async ({ dir }) => {
      await storedBySetup(dir, ".env.local");
      registerSignInLookup(async () => {
        throw new ZitadelError("E_AUTH", "Your sign-in was revoked or expired.");
      });

      await expect(new ProjectProbe(["--cwd", dir], config).probe()).rejects.toMatchObject({
        code: "E_AUTH",
      });
    });

    it("sends your sign-in alone when the server refuses it", async ({ dir, server }) => {
      await storedBySetup(dir, ".env.local");
      signedIn();
      const presented: (string | null)[] = [];
      server.use(
        http.get(`${SERVER}/api/v1/projects/:id`, ({ request }) => {
          presented.push(request.headers.get("authorization"));
          return HttpResponse.json({ code: "unauthenticated", message: "no" }, { status: 401 });
        }),
      );
      const { connection } = await new ProjectProbe(["--cwd", dir], config).probe();

      await expect(connection.client.getProject("proj_staging")).rejects.toThrow();

      expect(presented).toEqual([`Bearer ${SIGNED_IN.token}`]);
    });
  });

  describe("--credential project", () => {
    it("takes the stored secret over your sign-in", async ({ dir }) => {
      await storedBySetup(dir, ".env.local");
      const { lookups } = signedIn();

      const { connection } = await new ProjectProbe(
        ["--cwd", dir, "--credential", "project"],
        config,
      ).probe();

      expect(connection.credential).toBe("project");
      expect(lookups).toEqual([]);
    });

    it("fails naming the variable rather than acting as you", async ({ dir }) => {
      await writeFile(join(dir, ".env.development.local"), URL_AND_PROJECT);
      signedIn();

      await expect(
        new ProjectProbe(["--cwd", dir, "--credential", "project"], config).probe(),
      ).rejects.toMatchObject({
        code: "E_VALIDATION",
        message: expect.stringContaining("ZITADEL_PROJECT_SECRET"),
        hint: expect.not.stringContaining("zitadel login"),
      });
    });
  });

  it("refuses a --credential it does not know", async ({ dir }) => {
    await storedBySetup(dir, ".env.local");

    await expect(
      new ProjectProbe(["--cwd", dir, "--credential", "preview"], config).probe(),
    ).rejects.toThrow(/project, login/);
  });

  describe("--credential login", () => {
    it("takes your sign-in over a secret the run names", async ({ dir }) => {
      const file = await envFile(dir, `${URL_AND_PROJECT}ZITADEL_PROJECT_SECRET=sk_staging\n`);
      signedIn();

      const { connection } = await new ProjectProbe(
        ["--cwd", dir, "--env-file", file, "--credential", "login"],
        config,
      ).probe();

      expect(connection.credential).toBe("login");
    });

    it("fails when nobody is signed in, suggesting zitadel login", async ({ dir }) => {
      await storedBySetup(dir, ".env.local");
      nobodySignedIn();

      await expect(
        new ProjectProbe(["--cwd", dir, "--credential", "login"], config).probe(),
      ).rejects.toMatchObject({
        code: "E_CREDENTIAL_MISSING",
        nextCommands: [expect.stringContaining(`login --server ${SERVER}`)],
      });
    });
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

  it("reflects --credential, which the next run would otherwise choose by the default order", async ({
    dir,
  }) => {
    const { selector } = await new SelectorProbe(
      ["--cwd", dir, "--credential", "login"],
      config,
    ).probe();

    expect(selector).toBe(` --credential login --cwd ${dir}`);
  });

  it("keeps --credential once when it retries the run", async ({ dir }) => {
    const { retry } = await new SelectorProbe(
      ["--cwd", dir, "--credential", "login"],
      config,
    ).probe();

    expect(retry).toMatch(/ deploy -m fix --credential login --cwd /);
  });
});

describe("PreviewCommand.connect", () => {
  it("never acts as you, even with no secret to read", async ({ dir }) => {
    const file = await envFile(dir, URL_AND_PROJECT);
    const { lookups } = signedIn();

    await expect(
      new PreviewCommandProbe(["--cwd", dir, "--env-file", file], config).probe(),
    ).rejects.toMatchObject({ message: expect.stringContaining("ZITADEL_PROJECT_SECRET") });
    expect(lookups).toEqual([]);
  });

  it("uses the secret setup stored while you are signed in", async ({ dir }) => {
    await storedBySetup(dir, ".env.local");
    signedIn();

    const { connection } = await new PreviewCommandProbe(["--cwd", dir], config).probe();

    expect(connection.credential).toBe("project");
  });

  it("refuses --credential login", async ({ dir }) => {
    await storedBySetup(dir, ".env.local");
    signedIn();

    await expect(
      new PreviewCommandProbe(["--cwd", dir, "--credential", "login"], config).probe(),
    ).rejects.toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("never acts as you"),
    });
  });

  it("fails on a terminal rather than asking for a missing preview token", async ({ dir }) => {
    const file = await envFile(dir, URL_AND_PROJECT);

    await expect(
      asTerminal(() => new PreviewCommandProbe(["--cwd", dir, "--env-file", file], config).probe()),
    ).rejects.toMatchObject({ code: "E_VALIDATION" });
    expect(text).not.toHaveBeenCalled();
    expect(password).not.toHaveBeenCalled();
  });
});

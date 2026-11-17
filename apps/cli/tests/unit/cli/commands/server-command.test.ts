import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ChoosingServerCommand,
  LocalServerCommand,
  ServerCommand,
} from "@/cli/commands/server-command";
import { BaseCommand } from "@/lib/oclif";
import { LocalRuntime, PsLocalServers, SystemMachine, ZitadelRuntime } from "@/lib/server";
import { shellCommand } from "@/lib/suggestion";
import { aConfigAt } from "@tests/helpers/suggestions";

/** A command that takes a server, with its protected reading opened for the test. */
class TakesAServer extends ServerCommand(BaseCommand) {
  public static override readonly id: string = "takes-a-server-test";

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public async metaOf(flags: Record<string, unknown>, options = {}) {
    return this.toMeta({ "no-telemetry": true, ...flags }, options);
  }
}

/** A command that may have to ask for its server. */
class ChoosesAServer extends ChoosingServerCommand(BaseCommand) {
  public static override readonly id: string = "chooses-a-server-test";

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public async chooseWith(flags: Record<string, unknown>) {
    await this.toMeta({ "no-telemetry": true, "non-interactive": true, ...flags });
    return this.serverOrAsk(shellCommand("docker", "version"));
  }
}

/** A command about the server on this machine, in the folder its rule picks. */
class AboutTheLocalServer extends LocalServerCommand(BaseCommand, "exact") {
  public static override readonly id: string = "about-the-local-server-test";

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public sourceIn(cwd: string) {
    return this.sourceOf({}, cwd);
  }

  public get theMachine() {
    return this.machine();
  }

  public get theServers() {
    return this.localServers();
  }
}

/** The same, in the closest folder that started a server. */
class AboutTheNearestServer extends LocalServerCommand(BaseCommand, "nearest") {
  public static override readonly id: string = "about-the-nearest-server-test";

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public sourceIn(cwd: string) {
    return this.sourceOf({}, cwd);
  }
}

/** A command about the local server with no rule of its own, which names its own source. */
class AboutAnyLocalServer extends LocalServerCommand(BaseCommand) {
  public static override readonly id: string = "about-any-local-server-test";

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public sourceIn(cwd: string) {
    return this.sourceOf({}, cwd);
  }
}

const VERSION = "0.0.0-test";
const folders: string[] = [];

async function aFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "zitadel-server-command-"));
  folders.push(folder);
  return folder;
}

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => {
      return rm(folder, { recursive: true, force: true });
    }),
  );
});

describe("ServerCommand", () => {
  it("resolves a run with no --server to the cloud", async () => {
    const command = new TakesAServer([], aConfigAt(VERSION));

    const meta = await command.metaOf({});

    expect(meta.source).toBe(ZitadelRuntime.DEFAULT);
    expect(meta.serverFlag).toBeUndefined();
  });

  it("resolves --server to the server's origin and keeps the flag", async () => {
    const command = new TakesAServer([], aConfigAt(VERSION));

    const meta = await command.metaOf({ server: "https://auth.acme.example/some/path" });

    expect(meta.source).toBe("https://auth.acme.example");
    expect(meta.serverFlag).toBe("https://auth.acme.example/some/path");
  });

  it("leaves a command that names its own server to name it", async () => {
    const command = new TakesAServer([], aConfigAt(VERSION));

    const meta = await command.metaOf({}, { source: "http://localhost:9" });

    expect(meta.source).toBe("http://localhost:9");
  });
});

describe("ChoosingServerCommand", () => {
  it("uses the server --server named, resolved as every command resolves it", async () => {
    const command = new ChoosesAServer([], aConfigAt(VERSION));

    await expect(command.chooseWith({ server: "https://auth.acme.example/x" })).resolves.toBe(
      "https://auth.acme.example",
    );
  });

  it("refuses to ask when no one can be asked and no server was given", async () => {
    const command = new ChoosesAServer([], aConfigAt(VERSION));

    await expect(command.chooseWith({})).rejects.toMatchObject({ code: "E_VALIDATION" });
  });
});

describe("LocalServerCommand", () => {
  it("states the rule it acts on a folder by, and sets no group of its own", () => {
    expect(AboutTheLocalServer.folderRule).toBe("exact");
    expect(AboutTheNearestServer.folderRule).toBe("nearest");
    expect(AboutAnyLocalServer.folderRule).toBeUndefined();
    expect(AboutTheLocalServer.group).toBeUndefined();
  });

  it("leaves the server of a command with no rule to the command", async () => {
    await expect(
      new AboutAnyLocalServer([], aConfigAt(VERSION)).sourceIn(await aFolder()),
    ).resolves.toBeUndefined();
  });

  it("asks the machine and its processes through the seams a test replaces", () => {
    const command = new AboutTheLocalServer([], aConfigAt(VERSION));

    expect(command.theMachine).toBeInstanceOf(SystemMachine);
    expect(command.theServers).toBeInstanceOf(PsLocalServers);
  });

  it("names the default server for a folder that started none, in either rule", async () => {
    const folder = await aFolder();

    await expect(new AboutTheLocalServer([], aConfigAt(VERSION)).sourceIn(folder)).resolves.toBe(
      LocalRuntime.DEFAULT_URL,
    );
    await expect(new AboutTheNearestServer([], aConfigAt(VERSION)).sourceIn(folder)).resolves.toBe(
      LocalRuntime.DEFAULT_URL,
    );
  });
});

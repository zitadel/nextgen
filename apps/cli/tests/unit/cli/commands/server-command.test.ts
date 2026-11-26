import type { Callback, Mixpanel as MixpanelClient, Modifiers } from "mixpanel";
import { describe, expect, expectTypeOf } from "vitest";

import {
  ChoosingServerCommand,
  LocalServerCommand,
  ServerCommand,
} from "@/cli/commands/server-command";
import { type Admitted, BaseCommand, EnvironmentCommand } from "@/cli/core";
import { Destructive } from "@/cli/core/destructive";
import { Previewable } from "@/cli/core/previewable";
import { LocalRuntime, PsLocalServers, RealMachine, ZitadelRuntime } from "@/lib/server";
import { shellCommand } from "@/lib/suggestion";
import { type Properties, Telemetry, type TelemetryDeps } from "@/lib/telemetry";
import { CommandGroups } from "@/cli/commands/groups";
import { Telemetered } from "@/cli/telemetry/telemetered";
import { ZitadelError } from "@/lib/errors";
import { it } from "@tests/fixtures";
import { aConfigAt } from "@tests/helpers/suggestions";
import { rejectionOf } from "@tests/helpers/thrown-value";

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

  public async metaOf(flags: Record<string, unknown>) {
    return this.toMeta({ "no-telemetry": true, ...flags });
  }

  public async chooseWith(flags: Record<string, unknown>) {
    await this.toMeta({ "no-telemetry": true, "non-interactive": true, ...flags });
    return (await this.givenServer()) ?? this.askServer(shellCommand("docker", "version"));
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
/** What a command's `logJson` was given, as the record an envelope is. */
function recordOf(json: unknown): Record<string, unknown> {
  if (typeof json === "object" && json !== null) {
    return Object.fromEntries(Object.entries(json));
  } else {
    return {};
  }
}

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

    const refusal = await rejectionOf(() => command.chooseWith({}));

    expect(refusal).toBeInstanceOf(ZitadelError);
    expect(refusal).toMatchObject({ code: "E_VALIDATION" });
  });
});

describe("LocalServerCommand", () => {
  it("states the rule it acts on a folder by, and sets no group of its own", () => {
    expect(AboutTheLocalServer.folderRule).toBe("exact");
    expect(AboutTheNearestServer.folderRule).toBe("nearest");
    expect(AboutAnyLocalServer.folderRule).toBeUndefined();
    expect(AboutTheLocalServer.group).toBeUndefined();
  });

  it("leaves the server of a command with no rule to the command", async ({ dir }) => {
    await expect(
      new AboutAnyLocalServer([], aConfigAt(VERSION)).sourceIn(dir),
    ).resolves.toBeUndefined();
  });

  it("asks the machine and its processes through the seams a test replaces", () => {
    const command = new AboutTheLocalServer([], aConfigAt(VERSION));

    expect(command.theMachine).toBeInstanceOf(RealMachine);
    expect(command.theServers).toBeInstanceOf(PsLocalServers);
  });

  it("names the default server for a folder that started none, in either rule", async ({
    dir: folder,
  }) => {
    await expect(new AboutTheLocalServer([], aConfigAt(VERSION)).sourceIn(folder)).resolves.toBe(
      LocalRuntime.DEFAULT_URL,
    );
    await expect(new AboutTheNearestServer([], aConfigAt(VERSION)).sourceIn(folder)).resolves.toBe(
      LocalRuntime.DEFAULT_URL,
    );
  });
});

/** What each kind of command reports of its server in an envelope, given what was typed. */
class Capturing extends ServerCommand(BaseCommand) {
  public static override readonly id: string = "capturing-test";
  public readonly json: Record<string, unknown>[] = [];

  public override jsonEnabled(): boolean {
    return true;
  }

  public override logJson(json: unknown): void {
    this.json.push(recordOf(json));
  }

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public async failAfterFlags(flags: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.toMeta({ "no-telemetry": true, ...flags });
    return this.failWith(new Error("It failed"));
  }

  public async failBeforeFlags(): Promise<Record<string, unknown>> {
    return this.failWith(new Error("It failed"));
  }

  private async failWith(error: Error): Promise<Record<string, unknown>> {
    // catch() ends by throwing oclif's ExitError
    await rejectionOf(() => this.catch(error));
    return this.json[0] ?? {};
  }
}

/** The same, for a command that takes no server. */
class CapturingNoServer extends BaseCommand {
  public static override readonly id: string = "capturing-no-server-test";
  public readonly json: Record<string, unknown>[] = [];

  public override jsonEnabled(): boolean {
    return true;
  }

  public override logJson(json: unknown): void {
    this.json.push(recordOf(json));
  }

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public async failBeforeFlags(): Promise<Record<string, unknown>> {
    // catch() ends by throwing oclif's ExitError
    await rejectionOf(() => this.catch(new Error("It failed")));
    return this.json[0] ?? {};
  }
}

describe("the server a failure names", () => {
  it.each([
    { typed: undefined, source: ZitadelRuntime.DEFAULT },
    { typed: "https://auth.acme.example/path", source: "https://auth.acme.example" },
  ])("is $source after the flags, when --server is $typed", async ({ typed, source }) => {
    const envelope = await new Capturing([], aConfigAt(VERSION)).failAfterFlags({
      ...(typed === undefined ? {} : { server: typed }),
    });

    expect(envelope).toMatchObject({ source });
  });

  it("is the one --server named before the flags were parsed, as --server=<url> or --server <url>", async () => {
    for (const argv of [
      ["--bogus", "--server=https://auth.acme.example"],
      ["--bogus", "--server", "https://auth.acme.example"],
    ]) {
      const envelope = await new Capturing(argv, aConfigAt(VERSION)).failBeforeFlags();

      expect(envelope).toMatchObject({ source: "https://auth.acme.example" });
    }
  });

  it("is none for a command that takes no server, whatever was typed", async () => {
    const envelope = await new CapturingNoServer(
      ["--server=https://auth.acme.example"],
      aConfigAt(VERSION),
    ).failBeforeFlags();

    expect(envelope.source).toBe("");
  });
});

/** A command that reads an environment, and so a server, with its failure captured. */
class CapturingEnvironment extends Telemetered(ServerCommand(EnvironmentCommand)) {
  public static override readonly id: string = "capturing-environment-test";
  public readonly json: Record<string, unknown>[] = [];
  public readonly events: { event: string; properties: Properties }[] = [];

  public override jsonEnabled(): boolean {
    return true;
  }

  public override logJson(json: unknown): void {
    this.json.push(recordOf(json));
  }

  protected override createTelemetry(_deps: TelemetryDeps): Telemetry {
    const events = this.events;
    const client: MixpanelClient = {
      track(event: string, properties: Properties, callback?: Callback): void {
        events.push({ event, properties });
        callback?.(undefined);
      },
      people: {
        set(
          _distinctId: string,
          _properties: Properties,
          _modifiers?: Modifiers,
          callback?: Callback,
        ): void {
          callback?.(undefined);
        },
        set_once(
          _distinctId: string,
          _properties: Properties,
          _modifiers?: Modifiers,
          callback?: Callback,
        ): void {
          callback?.(undefined);
        },
      },
    };
    return Telemetry.create({
      env: { ZITADEL_TELEMETRY_TOKEN: "tok" },
      flag: true,
      initClient: () => client,
      loadIdentity: () => ({ distinctId: "did-test", isFirstRun: false }),
    });
  }

  protected async execute(): Promise<never> {
    throw new Error("unused");
  }

  public async failAfterFlags(flags: Record<string, unknown>): Promise<Record<string, unknown>> {
    await this.toMeta(flags);
    // catch() ends by throwing oclif's ExitError
    await rejectionOf(() => this.catch(new Error("It failed")));
    return this.json[0] ?? {};
  }
}

describe("the server of a command that reads an environment", () => {
  it("is the one --server named, in the failure and in the telemetry of the failed run", async () => {
    const command = new CapturingEnvironment([], aConfigAt(VERSION));

    const envelope = await command.failAfterFlags({ server: "https://auth.acme.example/path" });

    expect(envelope).toMatchObject({ source: "https://auth.acme.example" });
    expect(command.events.at(-1)?.properties).toMatchObject({ server_kind: "self_hosted" });
  });
});

/**
 * A command that reads an environment and says nothing of how it reads a server:
 * `servers()` is what `ServerCommand` implements, so this does not compile.
 */
// @ts-expect-error `servers()` is left abstract
class Bare extends EnvironmentCommand {
  protected async execute(): Promise<never> {
    throw new Error("unused");
  }
}

describe("the types a server mixin gives a command", () => {
  it("type --server for a command admitted under the mixin", () => {
    expectTypeOf<Admitted<typeof TakesAServer>["flags"]["server"]>().toEqualTypeOf<
      string | undefined
    >();
  });

  it("leave a command that reads an environment to say how it reads a server", () => {
    expect(Object.hasOwn(Bare.prototype, "servers")).toBe(false);
  });

  it("keep the group and the folder rule of a command that is also destructive", () => {
    class Destroying extends Destructive(Previewable(LocalServerCommand(BaseCommand, "exact"))) {
      static override group = CommandGroups.localServer;

      protected async preview(): Promise<never> {
        throw new Error("unused");
      }

      protected async apply(): Promise<never> {
        throw new Error("unused");
      }
    }

    expect(Destroying.group).toBe(CommandGroups.localServer);
    expect(Destroying.folderRule).toBe("exact");
  });
});

describe("the server of a command that chooses it", () => {
  it("names none until it is asked", async () => {
    const meta = await new ChoosesAServer([], aConfigAt(VERSION)).metaOf({});

    expect(meta.source).toBe("");
  });
});

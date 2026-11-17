import type { ServerAddresses } from "@/lib/environment";
import { serverFlag } from "@/lib/oclif/flags";
import type { BaseCommand } from "@/lib/oclif";
import type { CommandClass } from "@/lib/oclif/command-class";
import { Promptable } from "@/lib/oclif/promptable";
import {
  LocalRuntime,
  type LocalMachine,
  type LocalServers,
  PsLocalServers,
  RealMachine,
  ZitadelRuntime,
} from "@/lib/server";
import type { SuggestedCommand } from "@/lib/suggestion";
import { log } from "@/lib/ui";

/**
 * `--server`: the one flag every {@link ServerCommand} takes, declared once so
 * every command carries the same one.
 */
export const SERVER_FLAG = serverFlag({
  char: "s",
  description: "Override the resolved server URL.",
});

/**
 * Marks a command that talks to a Zitadel server, and gives it the one way a
 * server is read: `--server` (or the cloud default) is
 * resolved into the run's server before the command starts, so its events,
 * failures and follow-up commands all name the same one.
 *
 * ```ts
 * export default class Origins extends ServerCommand(EnvironmentCommand) {}
 * ```
 *
 * A command never resolves, parses or normalises a server address itself: it
 * reads `this.meta.source`, or extends {@link ChoosingServerCommand} when it
 * may have to ask for one. A command that names its own server returns it from
 * `sourceOf`, which wins over what this resolves.
 *
 * @param Base - The command class to extend.
 * @returns The class, taking a server.
 */
export function ServerCommand<
  TBase extends CommandClass<BaseCommand> &
    Pick<typeof BaseCommand, "baseFlags" | "enableJsonFlag">,
>(Base: TBase) {
  const { cwd, ...others } = Base.baseFlags;
  abstract class ServerResolving extends Base {
    // oclif reads a command's statics up the chain of classes only while each
    // declares a static of its own, so this mixin declares the two it passes on.
    // `--server` sits after `--cwd`, where the help and the reference list it.
    static override baseFlags = { cwd: cwd, server: SERVER_FLAG, ...others };
    static override enableJsonFlag = Base.enableJsonFlag;

    /**
     * Resolves `--server` for the run: `local` through the folder's record, a
     * URL as its origin, none as the cloud default.
     *
     * @param cwd - The directory the run addresses.
     * @param serverFlag - What `--server` was given, if it was.
     * @returns The run's server.
     * @throws {ZitadelError} When the server is not a server, or `local` and none runs.
     */
    protected override async resolveServer(
      cwd: string,
      serverFlag: string | undefined,
    ): Promise<string> {
      return (await this.servers().resolve({ cwd, serverFlag })).value;
    }

    /**
     * @param flags - The parsed flags.
     * @returns What `--server` was given as, if it was.
     */
    protected override serverFlagOf(flags: Record<string, unknown>): string | undefined {
      return typeof flags.server === "string" ? flags.server : undefined;
    }

    /**
     * @returns What `--server` was typed as on the command line, for a failure
     *   that came before the flags were parsed.
     */
    protected override serverFlagFromArgv(): string | undefined {
      return this.argvFlag("--server");
    }

    /**
     * How a server address is read from a flag, an environment file or an
     * answer, for a command that reads an environment.
     *
     * @returns What resolves, parses and normalises a server address.
     */
    protected servers(): ServerAddresses {
      return ZitadelRuntime;
    }
  }
  return ServerResolving;
}

/**
 * A {@link ServerCommand} that asks for the server when none was given, as a
 * command does that can run before a project says where it lives.
 *
 * ```ts
 * export default class EnvAdd extends ChoosingServerCommand(BaseCommand) {}
 * ```
 *
 * It resolves nothing until it is asked to: with no `--server` its `source`
 * stays empty rather than becoming the cloud, and {@link givenServer} and
 * {@link askServer} say which server the run is about.
 *
 * @param Base - The command class to extend.
 * @returns The class, taking a server and able to ask for one.
 */
export function ChoosingServerCommand<
  TBase extends CommandClass<BaseCommand> &
    Pick<typeof BaseCommand, "baseFlags" | "enableJsonFlag">,
>(Base: TBase) {
  abstract class ServerChoosing extends Promptable(ServerCommand(Base)) {
    /**
     * Resolves nothing before the person is asked: the run's `source` stays
     * empty, as it does for a command that names no server, and
     * {@link givenServer} resolves `--server` when it was given.
     *
     * @returns No server.
     */
    protected override async resolveServer(): Promise<string> {
      return "";
    }

    /**
     * The server `--server` named, resolved as every command resolves it.
     *
     * @returns The server's address, or `undefined` when none was given.
     * @throws {ZitadelError} When the flag is not a server, or `local` and none runs.
     */
    protected async givenServer(): Promise<string | undefined> {
      const { cwd, serverFlag } = this.meta;
      if (serverFlag) {
        return (await this.servers().resolve({ cwd, serverFlag })).value;
      } else {
        return undefined;
      }
    }

    /**
     * Asks which server the run is about, with the cloud as the suggestion. With
     * no one to ask, it refuses the missing flag.
     *
     * @param retry - The command that reruns this one, so a refusal can offer it.
     * @returns The server's address.
     * @throws {ZitadelError} When the answer is not a server, or no one can be asked.
     */
    protected async askServer(retry: SuggestedCommand): Promise<string> {
      return this.ask.text({
        name: "server",
        message: "What is the URL of your Zitadel server?",
        flag: "--server",
        initialValue: ZitadelRuntime.DEFAULT,
        parse: (value) => this.servers().parse(value),
        retry,
      });
    }
  }
  return ServerChoosing;
}

/**
 * A command about the Zitadel server that runs on this machine.
 *
 * Every such command acts on one project folder. `folderRule` says which: with
 * `"exact"` it is the folder the command runs in (`start`, `stop`, `reset`), and
 * with `"nearest"` it is the closest folder, that one or a parent, where `start`
 * was run (`logs`). Acting on the wrong one manages another project's server, so
 * a command states its rule and nothing else decides it. A command that finds its
 * own folder (`console`, `doctor`) states none and names its own `sourceOf`.
 *
 * ```ts
 * export default class Logs extends LocalServerCommand(BaseCommand, "nearest") {}
 * export default class Reset extends Destructive(LocalServerCommand(BaseCommand, "exact")) {}
 * ```
 *
 * It does not take `--server`: a command that also reads one is
 * `LocalServerCommand(ServerCommand(Base))`. It sets no group: each command
 * declares its own.
 *
 * @param Base - The command class to extend.
 * @param folderRule - Which folder the command acts on, if one rule decides it.
 * @returns The class, about the local server.
 */
export function LocalServerCommand<TBase extends CommandClass<BaseCommand>>(
  Base: TBase,
  folderRule?: "exact" | "nearest",
) {
  abstract class LocalServerManaging extends Base {
    static folderRule = folderRule;

    /**
     * The server of exactly the folder the command runs in. It may not have been
     * started yet.
     *
     * @param cwd - The folder; the command's own unless a caller names another.
     * @returns That folder's server.
     */
    protected serverInThisFolder(cwd = this.cwd): LocalRuntime {
      return LocalRuntime.forFolder(cwd, {
        cliVersion: this.config.version,
        progress: (message) => {
          log.info(message);
        },
      });
    }

    /**
     * The server of the closest folder, this one or a parent, where `start` was
     * run.
     *
     * @param cwd - Where to start looking; the command's own folder unless a caller names another.
     * @returns That folder's server, or `undefined` when no folder above started one.
     */
    protected serverInNearestFolder(cwd = this.cwd): Promise<LocalRuntime | undefined> {
      return LocalRuntime.findStartedFrom(cwd, {
        cliVersion: this.config.version,
        progress: (message) => {
          log.info(message);
        },
      });
    }

    /**
     * What this machine can tell a command about local servers. Production asks
     * the real one; a test overrides this to answer for the machine.
     *
     * @returns The machine.
     */
    protected machine(): LocalMachine {
      return new RealMachine();
    }

    /**
     * Which local servers are running on the machine. Production asks `ps`; a
     * test overrides this to answer for the machine.
     *
     * @returns The machine's processes.
     */
    protected localServers(): LocalServers {
      return new PsLocalServers();
    }

    /**
     * The address every event and refusal of the run names. It is read before the
     * run starts, so the very first event already names the right server.
     *
     * @param flags - The parsed flags.
     * @param cwd - The folder the command runs in.
     * @returns The server's address, or the default one when none was started;
     *   with no rule, what the command itself says.
     */
    protected override async sourceOf(
      flags: Record<string, unknown>,
      cwd: string,
    ): Promise<string | undefined> {
      if (folderRule === undefined) {
        return super.sourceOf(flags, cwd);
      } else if (folderRule === "nearest") {
        const server = await this.serverInNearestFolder(cwd);
        if (server === undefined) {
          return LocalRuntime.DEFAULT_URL;
        } else {
          return server.url();
        }
      } else {
        return this.serverInThisFolder(cwd).url();
      }
    }
  }
  return LocalServerManaging;
}

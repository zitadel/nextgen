import {
  LocalRuntime,
  type LocalMachine,
  type LocalServers,
  type MachineChecks,
  PsLocalServers,
  SystemMachine,
} from "@/lib/server";
import { CommandGroups } from "@/cli/commands/groups";
import { log } from "@/lib/ui";
import { BaseCommand } from "@/lib/oclif";

/**
 * A command about the Zitadel server that runs on this machine.
 *
 * Every such command acts on one project folder. `folderRule` says which: with
 * `"exact"` it is the folder the command runs in (`start`, `stop`, `reset`), and
 * with `"nearest"` it is the closest folder, that one or a parent, where `start`
 * was run (`logs`, `console`). Acting on the wrong one manages another
 * project's server, so a command states its rule and nothing else decides it.
 *
 * `status` is the one command about this server that does not extend it: it also
 * reads the project's environment, so it extends `EnvironmentCommand`.
 */
export abstract class ServerCommand extends BaseCommand {
  static override group: string = CommandGroups.localServer;
  static override meta = { resolveServer: false };
  static folderRule: "exact" | "nearest" = "exact";

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
  protected machine(): LocalMachine & MachineChecks {
    return new SystemMachine();
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
   * @param _flags - Unused; the folder alone decides.
   * @param cwd - The folder the command runs in.
   * @returns The server's address, or the default one when none was started.
   */
  protected override async sourceOf(_flags: unknown, cwd: string): Promise<string> {
    const { folderRule } = this.constructor as typeof ServerCommand;
    if (folderRule === "nearest") {
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

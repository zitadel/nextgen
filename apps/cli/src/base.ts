import { Command, Flags } from "@oclif/core";
import consola from "consola";

import type { CliIO, GlobalOptions } from "./io/output";
import { defaultIO, writeError } from "./io/output";
import { toZitadelError } from "./lib/errors";
import { resolveServer } from "./lib/api/resolve-server";
import { resolveCwd } from "./lib/paths";
import { CLI_VERSION } from "./lib/version";

/**
 * Base class for every oclif command. Owns the global flags, builds the
 * {@link GlobalOptions} meta (including server `source` resolution) that the
 * domain `run*` functions in `lib/commands` consume, and translates any thrown
 * error into the Zitadel JSON/pretty envelope plus the mapped process exit
 * code. Commands stay thin: parse flags, build meta, delegate to a `run*`
 * function which emits the envelope through {@link CliIO}. The agent contract
 * (ADR 004) is preserved — oclif only replaces parsing, dispatch, and help.
 */
export abstract class BaseCommand extends Command {
  /** Flags shared by every command, inherited via oclif `baseFlags`. */
  static baseFlags = {
    json: Flags.boolean({ description: "Emit the JSON envelope instead of pretty output." }),
    cwd: Flags.string({ char: "c", description: "Project directory to operate on." }),
    server: Flags.string({ char: "s", description: "Override the resolved server URL." }),
    "non-interactive": Flags.boolean({
      char: "n",
      description: "Disable prompts. Required when scripting or running as an agent.",
    }),
    force: Flags.boolean({ char: "f", description: "Overwrite protected files on conflict." }),
    "dry-run": Flags.boolean({ description: "Preview without mutating files or the platform." }),
    verbose: Flags.boolean({ description: "Verbose logging." }),
    debug: Flags.boolean({ description: "Debug logging." }),
  };

  /** IO sink the domain functions write the envelope to (real process streams). */
  protected io: CliIO = defaultIO;
  /** Resolved meta for the current invocation; set by {@link toMeta}. */
  protected meta: GlobalOptions = fallbackMeta();

  /**
   * Builds {@link GlobalOptions} from parsed flags, resolving the server
   * `source` by the documented precedence and storing the result on
   * `this.meta` so the error handler can render a complete envelope.
   */
  protected async toMeta(flags: Record<string, unknown>): Promise<GlobalOptions> {
    const cwd = resolveCwd(typeof flags.cwd === "string" ? flags.cwd : undefined);
    const serverFlag = typeof flags.server === "string" ? flags.server : undefined;
    const environment = typeof flags.environment === "string" ? flags.environment : "development";
    const source = await resolveServer({ cwd, env: this.io.env, serverFlag, environment });
    const json = Boolean(flags.json);
    const verbose = Boolean(flags.verbose);
    const debug = Boolean(flags.debug);
    consola.level = debug ? 4 : verbose ? 3 : 2;
    this.meta = {
      cwd,
      json,
      nonInteractive: Boolean(flags["non-interactive"]) || !this.io.isTTY || json,
      dryRun: Boolean(flags["dry-run"]),
      force: Boolean(flags.force),
      command: this.id ?? "(default)",
      cliVersion: CLI_VERSION,
      source: source.value,
      serverFlag,
      verbose,
      debug,
    };
    return this.meta;
  }

  /** Renders any thrown error as the Zitadel envelope and exits with its code. */
  protected async catch(error: unknown): Promise<never> {
    const zitadelError = toZitadelError(error);
    writeError(this.io, zitadelError, this.meta);
    return this.exit(zitadelError.exitCode);
  }
}

function fallbackMeta(): GlobalOptions {
  return {
    cwd: resolveCwd(undefined),
    json: false,
    nonInteractive: false,
    dryRun: false,
    force: false,
    command: "(default)",
    cliVersion: CLI_VERSION,
    source: "",
    verbose: false,
    debug: false,
  };
}

import { DEFAULT_SERVER } from "@zitadel/config/server";
import type { Parsed } from "@zitadel/config/idp";

import { ZitadelError, errorMessage } from "@/lib/errors";
import { isLoopbackHost } from "@/lib/host";
import { LocalServer } from "@/lib/local-server/server";
import type { FlagVariable } from "@/lib/oclif/types";

/**
 * The resolved target server plus the source it came from. `origin` is
 * retained (not just the value) so callers can report *why* a server was
 * chosen.
 */
export type ResolvedServer = {
  value: string;
  origin: "flag" | "default" | "local";
};

/**
 * Inputs to {@link Server.resolve}. Passed explicitly (cwd) rather than read
 * from globals so resolution is pure and testable. `serverFlag` comes from the
 * parsed CLI invocation.
 */
export type ResolveServerInput = {
  cwd: string;
  serverFlag?: string;
};

/**
 * The Zitadel server a command addresses, and the one way into everything the
 * CLI knows about one: the default, the variable that names it, how a typed or
 * flagged value becomes an origin, and what a URL says about where it points.
 */
export class Server {
  /**
   * Server URL used when nothing else resolves (`@zitadel/config/server`, which
   * the console shares). Also surfaced in hints and the interactive setup
   * prompt as the suggested value.
   */
  static readonly DEFAULT: string = DEFAULT_SERVER;

  /** The server's address, as it was given. */
  readonly address: string;

  /**
   * @param address - The server's address, as it was given.
   */
  private constructor(address: string) {
    this.address = address;
  }

  /** The variable {@link Server.resolve} reads when `--server` is not given. */
  static readonly VARIABLE: FlagVariable = {
    name: "ZITADEL_API_BASE",
    flag: "server",
    description: "The server URL, or `local`, as `--server` takes it.",
    precedence: "`--server` wins over it, and it wins over `server` in `zitadel.json`.",
  };

  /**
   * A server known by its address, as a hint, a flag or a response names it.
   *
   * @param address - The server's address.
   * @returns The server.
   */
  static at(address: string): Server {
    return new Server(address);
  }

  /**
   * Resolves which server `setup` should create its project on: the `--server`
   * flag, else {@link Server.DEFAULT}. Every other command takes its server
   * from `ZITADEL_URL` (see `Environment.resolve`), because a project belongs
   * to the server that created it and the default says nothing about that. A
   * flag value is validated to a normalised origin; an invalid URL throws a
   * `ZitadelError` rather than silently falling through.
   *
   * @param input - The project directory and the `--server` flag, when given.
   * @returns The server and where it came from.
   * @throws {ZitadelError} `E_VALIDATION` when the flag is not an http(s) URL,
   *   or the local server's own error when `local` is not running.
   */
  static async resolve(input: ResolveServerInput): Promise<ResolvedServer> {
    if (!input.serverFlag) {
      return { value: Server.DEFAULT, origin: "default" };
    }
    if (input.serverFlag === "local") {
      return { value: await LocalServer.resolveUrl(input.cwd), origin: "local" };
    }
    return { value: Server.origin(input.serverFlag), origin: "flag" };
  }

  /**
   * A typed or flagged server as its origin, or the problem with it: the
   * `parse` an input question takes, so a prompt re-asks instead of throwing
   * out of it.
   *
   * @param value - What was typed.
   * @returns The origin, or why the value is not a server.
   */
  static parse(value: string): Parsed<string> {
    const typed = value.trim();
    if (typed === "") {
      return {
        ok: false,
        problem: "The server URL cannot be empty",
      };
    }
    try {
      return {
        ok: true,
        value: Server.origin(typed),
      };
    } catch (error) {
      return {
        ok: false,
        problem: errorMessage(error),
      };
    }
  }

  /**
   * Normalises a server URL to its origin.
   *
   * @param value - The server's address.
   * @returns The origin.
   * @throws {ZitadelError} `E_VALIDATION` when it is not an http(s) URL.
   */
  static origin(value: string): string {
    if (!URL.canParse(value)) {
      throw new ZitadelError("E_VALIDATION", `Invalid server "${value}"`, {
        hint: `Use a URL like ${Server.DEFAULT}.`,
      });
    }
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ZitadelError("E_VALIDATION", `Server URL must use http(s): ${value}`, {
        hint: `Use a URL like ${Server.DEFAULT}.`,
      });
    }
    return url.origin;
  }

  /**
   * Loopback check on the URL's hostname: `localhost`, the whole `127.0.0.0/8`
   * block, or `[::1]` (how WHATWG URLs spell IPv6 loopback).
   *
   * @returns `true` when it points at this machine.
   */
  isLoopback(): boolean {
    try {
      return isLoopbackHost(new URL(this.address).hostname);
    } catch {
      return false;
    }
  }

  /**
   * What kind of server this is, for a decision or an event that must not carry
   * the address: the hosted cloud, one on this machine (`mock` is the test
   * double of one), any other server, or an address that is not a URL.
   *
   * @returns The kind.
   */
  get kind(): "cloud" | "local" | "self_hosted" | "unknown" {
    if (this.address === "mock") {
      return "local";
    }
    if (!URL.canParse(this.address)) {
      return "unknown";
    }
    if (this.isCloud()) {
      return "cloud";
    }

    return this.isLoopback() ? "local" : "self_hosted";
  }

  /**
   * Whether this is Zitadel's hosted cloud: the default server or a host under
   * `zitadel.cloud`.
   *
   * @returns `true` when the address is a hosted cloud's.
   */
  isCloud(): boolean {
    try {
      const { hostname } = new URL(this.address);
      return (
        hostname === new URL(Server.DEFAULT).hostname ||
        hostname === "zitadel.cloud" ||
        hostname.endsWith(".zitadel.cloud")
      );
    } catch {
      return false;
    }
  }

  /**
   * Where this server's console is: `/console/` on the hosted cloud, which
   * serves it apart from the API, and `/ui/console/` on any other server.
   *
   * @returns The console's address, with its trailing slash.
   * @throws {ZitadelError} `E_VALIDATION` when the address is not an http(s) URL.
   */
  consoleUrl(): string {
    return `${Server.origin(this.address)}${this.isCloud() ? "/console/" : "/ui/console/"}`;
  }

  /**
   * The host of a server, for an ending that says where a run happened, or
   * `undefined` for the default server, which a reader does not need told, and
   * for an address that is not a URL.
   *
   * @returns The host, or `undefined` when there is nothing to say.
   */
  hostUnlessDefault(): string | undefined {
    try {
      const { host } = new URL(this.address);
      return host === new URL(Server.DEFAULT).host ? undefined : host;
    } catch {
      return undefined;
    }
  }
}

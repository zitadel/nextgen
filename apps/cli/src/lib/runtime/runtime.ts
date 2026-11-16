import { release } from "node:os";

/** Process facts the user agent is built from, surfaced as data so it is testable. */
export type UserAgentFacts = {
  readonly cliVersion: string;
  readonly nodeVersion: string;
  readonly platform: NodeJS.Platform;
  readonly osRelease: string;
  readonly arch: string;
};

/**
 * What is true of this run of the CLI as a whole, rather than of one command: the `User-Agent` it
 * sends and whether a contributor started it in development mode.
 *
 * Both are process-wide and read from places that otherwise share nothing (commands, the local
 * server, the HTTP client, telemetry), which is why they live in one small area of their own and
 * not with any of those callers.
 *
 * The `User-Agent` is sent on every HTTP request the CLI makes (the Zitadel API, local-server
 * health checks, branding asset probes, telemetry), so a server and its logs can tell CLI traffic
 * apart from any other Node client, and tell CLI versions apart. Node's `fetch` otherwise sends the
 * bare `node`. It is space-separated `product/version` tokens (RFC 9110 §10.1.5), in the style of
 * npm and the AWS CLI, most significant first:
 *
 *     zitadel-cli/1.0.0 node/v24.12.0 darwin/24.6.0 arch/arm64
 */
export class Runtime {
  /** The one runtime of this process, made on first use. */
  private static instance: Runtime | undefined;

  /**
   * The user agent of this run, until {@link Runtime.useUserAgent} sets the real one. A holder
   * rather than a reassigned binding, so the value has one home.
   */
  private readonly state: { userAgent: string };

  private constructor() {
    this.state = { userAgent: Runtime.userAgentFor("unknown") };
  }

  /**
   * The runtime of this process: what is true of this run as a whole is the same wherever it is
   * asked.
   *
   * @returns The runtime.
   */
  static current(): Runtime {
    Runtime.instance ??= new Runtime();
    return Runtime.instance;
  }

  /**
   * Whether this is a contributor's development run.
   *
   * The CLI ships as a single generic build, nothing is stamped into the bundle, so development
   * mode is an explicit runtime opt-in via `ZITADEL_CLI_DEV`. A published CLI never has it set, so
   * developer-only affordances (such as the local-IdP issuer prompt in `setup` and
   * `auth-method sso enable`) can never appear for someone who installed the CLI. Contributors set
   * `ZITADEL_CLI_DEV=1` when they want them; everything else (real installs, scripted runs, CI) is
   * a normal run.
   *
   * @param env - The environment to read, the process's own by default.
   * @returns Whether `ZITADEL_CLI_DEV` is set to anything but empty, `0` or `false`.
   */
  isDevelopment(env: NodeJS.ProcessEnv = process.env): boolean {
    const flag = env.ZITADEL_CLI_DEV?.trim().toLowerCase();
    return flag !== undefined && flag !== "" && flag !== "0" && flag !== "false";
  }

  /**
   * The user agent of this run.
   *
   * @returns The user agent {@link Runtime.useUserAgent} last set, or the placeholder before that.
   */
  userAgent(): string {
    return this.state.userAgent;
  }

  /**
   * Sets the user agent of this run, which every request the CLI makes carries.
   *
   * @param userAgent - The user agent, usually {@link Runtime.userAgentFor}'s.
   */
  useUserAgent(userAgent: string): void {
    this.state.userAgent = userAgent;
  }

  /**
   * The user agent of the running process.
   *
   * @param cliVersion - The running CLI's version.
   * @returns The user agent for this CLI version, Node, operating system and architecture.
   */
  static userAgentFor(cliVersion: string): string {
    return Runtime.buildUserAgent({
      cliVersion,
      nodeVersion: process.version,
      platform: process.platform,
      osRelease: release(),
      arch: process.arch,
    });
  }

  /**
   * The user agent that the given facts describe.
   *
   * @param facts - The process facts to describe.
   * @returns The space-separated product tokens.
   */
  static buildUserAgent(facts: UserAgentFacts): string {
    return [
      Runtime.product("zitadel-cli", facts.cliVersion),
      Runtime.product("node", facts.nodeVersion),
      Runtime.product(facts.platform, facts.osRelease),
      Runtime.product("arch", facts.arch),
    ].join(" ");
  }

  /**
   * One `name/version` product token. Characters outside the RFC 9110 `token` set (an OS release
   * string is free-form) become `_`, so a stray space or slash can never split one token into two.
   *
   * @param name - The product.
   * @param version - Its version.
   * @returns The token.
   */
  private static product(name: string, version: string): string {
    return `${Runtime.sanitizeToken(name)}/${Runtime.sanitizeToken(version)}`;
  }

  /**
   * A value restricted to the characters an HTTP token allows.
   *
   * @param value - A free-form value.
   * @returns The value with each other character replaced by `_`, or `unknown` when it is empty.
   */
  private static sanitizeToken(value: string): string {
    return value.replace(/[^!#$%&'*+\-.^_`|~0-9A-Za-z]/g, "_") || "unknown";
  }
}

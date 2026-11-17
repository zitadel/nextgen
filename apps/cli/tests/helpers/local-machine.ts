import type { LocalMachine, TcpListener } from "@/lib/server";

/**
 * What a {@link FakeMachine} answers. Every field has the answer of a
 * machine with no local server, every port free and no bundled release.
 */
export type MachineScript = Readonly<{
  /** The server running for the directory, if any. */
  detected?: string;
  /** The ports something holds. */
  taken?: readonly number[];
  /** The port to suggest in place of a taken one. */
  nextFree?: (port: number) => number | undefined;
  /** The server release the CLI ships. */
  bundled?: string;
  /** The processes that listen on each port. */
  listening?: Readonly<Record<number, readonly TcpListener[]>>;
  /** How the server reaches this machine's localhost. */
  reach?: "allowed" | "container" | "unknown";
}>;

/**
 * A machine that answers setup's questions about local servers as a test
 * scripts it, and never changes after it is built.
 */
export class FakeMachine implements LocalMachine {
  private readonly script: MachineScript;

  /**
   * @param script - The answers; whatever it leaves out is the answer of an empty machine.
   */
  constructor(script: MachineScript = {}) {
    this.script = script;
  }

  /**
   * @param _cwd - The directory asked about; the script does not tell directories apart.
   * @returns The scripted server, if any.
   */
  async detectUrl(_cwd: string): Promise<string | undefined> {
    return this.script.detected;
  }

  /**
   * @param port - The port asked about.
   * @returns Whether the script holds it.
   */
  async isPortFree(port: number): Promise<boolean> {
    return !(this.script.taken ?? []).includes(port);
  }

  /**
   * @param port - The port that is taken.
   * @returns What the script suggests; without a suggestion, the first of the next 20 ports the
   *   script does not hold, as the real machine finds it.
   */
  async nextFreePort(port: number): Promise<number | undefined> {
    if (this.script.nextFree) {
      return this.script.nextFree(port);
    }
    const count = Math.max(0, Math.min(port + 20, 65_535) - port);
    for (const next of Array.from({ length: count }, (_, index) => {
      return port + 1 + index;
    })) {
      if (await this.isPortFree(next)) {
        return next;
      }
    }
    return undefined;
  }

  /**
   * @returns The scripted release, if any.
   */
  bundledVersion(): string | undefined {
    return this.script.bundled;
  }

  /**
   * @param port - The port asked about.
   * @returns What the script has listening there.
   */
  async listeners(port: number): Promise<readonly TcpListener[]> {
    return this.script.listening?.[port] ?? [];
  }

  /**
   * @param _cwd - The folder asked about; the script does not tell folders apart.
   * @param _serverUrl - The server asked about.
   * @returns The scripted reach, `unknown` by default.
   */
  async loopbackReach(
    _cwd: string,
    _serverUrl: string,
  ): Promise<"allowed" | "container" | "unknown"> {
    return this.script.reach ?? "unknown";
  }
}

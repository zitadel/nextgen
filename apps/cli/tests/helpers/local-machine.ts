import type { LocalMachine } from "@/lib/server";

/**
 * What a {@link ScriptedMachine} answers. Every field has the answer of a
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
}>;

/**
 * A machine that answers setup's questions about local servers as a test
 * scripts it, and never changes after it is built.
 */
export class ScriptedMachine implements LocalMachine {
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
   * @returns What the script suggests, if anything.
   */
  async nextFreePort(port: number): Promise<number | undefined> {
    return this.script.nextFree?.(port);
  }

  /**
   * @returns The scripted release, if any.
   */
  bundledVersion(): string | undefined {
    return this.script.bundled;
  }
}

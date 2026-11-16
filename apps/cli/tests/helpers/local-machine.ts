import type { LocalMachine } from "@/lib/server";

/**
 * A machine that answers setup's questions about local servers as a test
 * scripts it, and remembers what it was asked. Everything starts as a machine
 * with no local server, every port free and no bundled release.
 */
export class ScriptedMachine implements LocalMachine {
  /** What `detectUrl` answers, one per call; the last repeats. */
  private detections: Array<string | undefined> = [undefined];

  /** Whether `isPortFree` answers yes. */
  portIsFree = true;

  /** What `nextFreePort` answers for a port. */
  nextFree: (port: number) => number | undefined | Promise<number | undefined> = () => {
    return undefined;
  };

  /** What `bundledVersion` answers. */
  bundled: string | undefined;

  /** What each question was asked about, in order. */
  readonly asked = {
    detectUrl: [] as string[],
    isPortFree: [] as number[],
    nextFreePort: [] as number[],
  };

  /**
   * Scripts the answers `detectUrl` gives from now on.
   *
   * @param answers - One per call; the last repeats.
   */
  detects(...answers: Array<string | undefined>): void {
    this.detections = answers;
  }

  /** Forgets every script and question, as a fresh machine would. */
  reset(): void {
    this.detections = [undefined];
    this.portIsFree = true;
    this.nextFree = () => {
      return undefined;
    };
    this.bundled = undefined;
    this.asked.detectUrl.length = 0;
    this.asked.isPortFree.length = 0;
    this.asked.nextFreePort.length = 0;
  }

  async detectUrl(cwd: string): Promise<string | undefined> {
    this.asked.detectUrl.push(cwd);
    const index = Math.min(this.asked.detectUrl.length, this.detections.length) - 1;

    return this.detections[index];
  }

  async isPortFree(port: number): Promise<boolean> {
    this.asked.isPortFree.push(port);

    return this.portIsFree;
  }

  async nextFreePort(port: number): Promise<number | undefined> {
    this.asked.nextFreePort.push(port);

    return this.nextFree(port);
  }

  bundledVersion(): string | undefined {
    return this.bundled;
  }
}

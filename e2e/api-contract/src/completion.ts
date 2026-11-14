import { EXIT_MARKER } from "./command";

/**
 * Collects a container's output as it streams and settles once the exit
 * marker line has arrived, with the status on it. Waiting on the line, instead
 * of on the container, does not depend on reading the logs of a container that
 * has already exited, and needs no polling: the output stream is the event.
 */
export class Completion {
  private text = "";
  private resolve: (exitCode: number) => void = () => {
    return undefined;
  };
  readonly exitCode: Promise<number>;

  constructor() {
    this.exitCode = new Promise<number>((resolve) => {
      this.resolve = resolve;
    });
  }

  /** Everything printed so far. */
  get log(): string {
    return this.text;
  }

  push(chunk: Buffer | string): void {
    this.text += String(chunk);
    const status = this.status();
    if (status !== undefined) {
      this.resolve(status);
    }
  }

  /** The status on the marker line, once the line is complete. */
  private status(): number | undefined {
    const match = new RegExp(`^${EXIT_MARKER} (\\d+)\\r?\\n`, "m").exec(this.text);
    return match === null ? undefined : Number(match[1]);
  }
}

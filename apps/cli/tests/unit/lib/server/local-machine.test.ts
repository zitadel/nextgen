import { describe, expect, it } from "vitest";

import { RealMachine } from "@/lib/server";

/** A port probe that holds the ports it is given and remembers every port it was asked about. */
class HeldPorts {
  /** The ports it was asked about, in order. */
  readonly asked: number[] = [];
  private readonly held: (port: number) => boolean;

  /**
   * @param held - Whether a port is held.
   */
  constructor(held: (port: number) => boolean) {
    this.held = held;
  }

  /**
   * @param port - The port asked about.
   * @returns Whether it is free.
   */
  async isFree(port: number): Promise<boolean> {
    this.asked.push(port);

    return !this.held(port);
  }
}

describe("RealMachine", () => {
  describe("a free port in place of a taken one", () => {
    it("is the first free one after it", async () => {
      const machine = new RealMachine(new HeldPorts((port) => port !== 3003));

      await expect(machine.nextFreePort(3000)).resolves.toBe(3003);
    });

    it("is none when the next 20 are taken too", async () => {
      const ports = new HeldPorts(() => true);

      await expect(new RealMachine(ports).nextFreePort(3000)).resolves.toBeUndefined();
      expect(ports.asked).toHaveLength(20);
    });

    it("never looks past the last port", async () => {
      const ports = new HeldPorts(() => true);

      await expect(new RealMachine(ports).nextFreePort(65_530)).resolves.toBeUndefined();
      expect(ports.asked.at(-1)).toBe(65_535);
    });
  });
});

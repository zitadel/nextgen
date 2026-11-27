import { realpath } from "node:fs/promises";
import { describe, expect } from "vitest";

import { RealMachine } from "@/lib/server";
import type { Run } from "@/lib/server/local/ports";
import { it } from "@tests/fixtures";

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

/**
 * A machine whose `lsof` lists `processes` as listening on port 3000, each in its folder; a process
 * with no folder is one lsof cannot name a folder for.
 *
 * @param processes - What listens, by pid.
 * @returns How programs are run there.
 */
function lsofListing(
  processes: readonly Readonly<{ pid: number; command: string; folder?: string }>[],
): Run {
  return async (_program, args) => {
    return {
      stdout: args.includes("cwd")
        ? processes
            .flatMap(({ pid, folder }) => {
              return folder === undefined ? [] : [`p${pid}`, "fcwd", `n${folder}`];
            })
            .join("\n")
        : processes
            .flatMap(({ pid, command }) => {
              return [`p${pid}`, `c${command}`, "f12", "n127.0.0.1:3000", "f13", "n[::1]:3000"];
            })
            .join("\n"),
    };
  };
}

describe("RealMachine", () => {
  describe("who holds a port the app is to run on", () => {
    const port3000Held = new HeldPorts((port) => port === 3000);

    it("is nobody when the port is free, without asking lsof", async ({ dir: app }) => {
      const machine = new RealMachine(new HeldPorts(() => false), async () => {
        throw new Error("lsof was asked about a free port");
      });

      await expect(machine.portHolder(3000, app)).resolves.toEqual({ kind: "none" });
    });

    it("is the app when the process holding it runs in the app's folder, however lsof spells it", async ({
      dir: app,
    }) => {
      const machine = new RealMachine(
        port3000Held,
        lsofListing([{ pid: 4242, command: "node", folder: await realpath(app) }]),
      );

      await expect(machine.portHolder(3000, app)).resolves.toEqual({ kind: "app" });
    });

    it("is another process when it runs in another folder", async ({ dir: app }) => {
      const machine = new RealMachine(
        port3000Held,
        lsofListing([{ pid: 4242, command: "node", folder: "/Users/me/other-app" }]),
      );

      await expect(machine.portHolder(3000, app)).resolves.toMatchObject({
        kind: "other",
        listeners: [
          { pid: 4242, command: "node" },
          { pid: 4242, command: "node" },
        ],
      });
    });

    it("is another process when one of two runs in another folder, which alone is named", async ({
      dir: app,
    }) => {
      const machine = new RealMachine(
        port3000Held,
        lsofListing([
          { pid: 4242, command: "node", folder: await realpath(app) },
          { pid: 4343, command: "com.docker", folder: "/" },
        ]),
      );

      await expect(machine.portHolder(3000, app)).resolves.toMatchObject({
        kind: "other",
        listeners: [{ pid: 4343 }, { pid: 4343 }],
      });
    });

    it("is another process when lsof names no folder for it", async ({ dir: app }) => {
      const machine = new RealMachine(port3000Held, lsofListing([{ pid: 4242, command: "node" }]));

      await expect(machine.portHolder(3000, app)).resolves.toMatchObject({
        kind: "other",
        listeners: [{ pid: 4242 }, { pid: 4242 }],
      });
    });

    it("is an unnamed other process when lsof sees nothing listening", async ({ dir: app }) => {
      const machine = new RealMachine(port3000Held, lsofListing([]));

      await expect(machine.portHolder(3000, app)).resolves.toEqual({
        kind: "other",
        listeners: [],
      });
    });
  });

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

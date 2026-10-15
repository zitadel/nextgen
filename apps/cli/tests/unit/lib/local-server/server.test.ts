import { describe, expect, it } from "vitest";

import {
  chooseFreePort,
  LocalServer,
  NoFreePortError,
  PortInUseError,
  ServerStartError,
  ServerStopError,
  type HealthProbe,
  type Launcher,
  type PortProbe,
  type ServerRecord,
  type ServerStore,
  type StopOutcome,
} from "../../../../src/lib/local-server/server";

type Record = ServerRecord & { version?: string };

/** A machine with ports, processes and a store held in memory. */
class World {
  record: Record | undefined;
  takenPorts = new Set<number>();
  alive = new Set<number>();
  /** Origins that answer /healthz, whoever answers them. */
  healthy = new Set<string>();
  launched: number[] = [];
  terminated: number[] = [];
  nextPid = 100;
  /** What `launch` does to the world, to model a process that dies or never answers. */
  onLaunch: (record: Record, world: World) => void = (record, world) => {
    world.alive.add(record.pid);
    world.healthy.add(record.server_url);
  };
  terminateResult: StopOutcome["status"] = "stopped";

  store: ServerStore<Record> = {
    read: async () => this.record,
    write: async (record) => {
      this.record = record;
    },
  };

  launcher: Launcher<Record> = {
    launch: async ({ port, serverUrl }) => {
      const record = { pid: this.nextPid++, port, server_url: serverUrl };
      this.launched.push(port);
      this.onLaunch(record, this);
      return record;
    },
    isAlive: (pid) => this.alive.has(pid),
    terminate: async (pid) => {
      this.terminated.push(pid);
      if (this.terminateResult === "stopped") {
        this.alive.delete(pid);
        const url = this.record?.pid === pid ? this.record.server_url : undefined;
        if (url) {
          this.healthy.delete(url);
        }
      }
      return { pid, status: this.terminateResult };
    },
  };

  ports: PortProbe = { isFree: async (port) => !this.takenPorts.has(port) };
  health: HealthProbe = { isHealthy: async (url) => this.healthy.has(url) };

  server(options: ConstructorParameters<typeof LocalServer<Record>>[1] = {}) {
    return new LocalServer<Record>(
      { store: this.store, launcher: this.launcher, ports: this.ports, health: this.health },
      { startTimeoutMs: 30, pollIntervalMs: 5, ...options },
    );
  }
}

describe("LocalServer", () => {
  describe("state", () => {
    it("is stopped when the directory has no record", async () => {
      const world = new World();

      await expect(world.server().state()).resolves.toEqual({ kind: "stopped" });
    });

    it("is running when the recorded process is alive and answers", async () => {
      const world = new World();
      world.record = { pid: 7, port: 8080, server_url: "http://localhost:8080" };
      world.alive.add(7);
      world.healthy.add("http://localhost:8080");

      await expect(world.server().state()).resolves.toMatchObject({ kind: "running" });
    });

    it("is dead when the recorded process is gone, even if something else answers there", async () => {
      const world = new World();
      world.record = { pid: 7, port: 8080, server_url: "http://localhost:8080" };
      world.healthy.add("http://localhost:8080");

      await expect(world.server().state()).resolves.toMatchObject({ kind: "dead" });
    });

    it("is dead when the recorded process is alive but does not answer", async () => {
      const world = new World();
      world.record = { pid: 7, port: 8080, server_url: "http://localhost:8080" };
      world.alive.add(7);

      await expect(world.server().state()).resolves.toMatchObject({ kind: "dead" });
    });
  });

  describe("start", () => {
    it("takes 8080 for a directory that has no server", async () => {
      const world = new World();

      const { record, alreadyRunning } = await world.server().start();

      expect(record.port).toBe(8080);
      expect(alreadyRunning).toBe(false);
    });

    it("takes the next free port when 8080 is held by another directory's server", async () => {
      const world = new World();
      world.takenPorts.add(8080);

      const { record } = await world.server().start();

      expect(record.port).toBe(8081);
      expect(record.server_url).toBe("http://localhost:8081");
    });

    it("records the server it started", async () => {
      const world = new World();

      const { record } = await world.server().start();

      expect(world.record).toEqual(record);
    });

    it("reuses a running server and does not launch another", async () => {
      const world = new World();
      await world.server().start();

      const second = await world.server().start();

      expect(second.alreadyRunning).toBe(true);
      expect(world.launched).toEqual([8080]);
    });

    it("keeps the port the directory had when it restarts", async () => {
      const world = new World();
      world.takenPorts.add(8080);
      await world.server().start();
      await world.server().stop();

      const { record } = await world.server().start();

      expect(record.port).toBe(8081);
    });

    it("moves a directory up when the port it had is now held by someone else", async () => {
      const world = new World();
      world.record = { pid: 7, port: 8085, server_url: "http://localhost:8085" };
      world.takenPorts.add(8085);

      const { record } = await world.server().start();

      expect(record.port).toBe(8086);
    });

    it("starts on the port it was asked for", async () => {
      const world = new World();

      const { record } = await world.server({ port: 9000 }).start();

      expect(record.port).toBe(9000);
    });

    it("refuses a port it was asked for that is held, instead of using another", async () => {
      const world = new World();
      world.takenPorts.add(9000);

      await expect(world.server({ port: 9000 }).start()).rejects.toBeInstanceOf(PortInUseError);
      expect(world.launched).toEqual([]);
    });

    it("restarts a running server that is not reusable", async () => {
      const world = new World();
      const { record: first } = await world.server().start();

      const second = await world.server({ reusable: () => false }).start();

      expect(world.terminated).toEqual([first.pid]);
      expect(second.alreadyRunning).toBe(false);
    });

    it("restarts a running server onto a different port when one is asked for", async () => {
      const world = new World();
      const { record: first } = await world.server().start();

      const { record } = await world.server({ port: 9000 }).start();

      expect(world.terminated).toEqual([first.pid]);
      expect(record.port).toBe(9000);
    });

    it("clears a dead record before it starts", async () => {
      const world = new World();
      world.record = { pid: 7, port: 8080, server_url: "http://localhost:8080" };

      await world.server().start();

      expect(world.terminated).toEqual([7]);
    });

    it("fails when the server cannot be stopped before the restart", async () => {
      const world = new World();
      world.record = { pid: 7, port: 8080, server_url: "http://localhost:8080" };
      world.terminateResult = "failed";

      await expect(world.server().start()).rejects.toBeInstanceOf(ServerStopError);
    });

    it("does not call another server's answer its own when its process dies at once", async () => {
      const world = new World();
      world.healthy.add("http://localhost:8080");
      world.onLaunch = (record, w) => {
        w.alive.add(record.pid);
        queueMicrotask(() => w.alive.delete(record.pid));
      };

      const error = await world
        .server()
        .start()
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ServerStartError);
      expect(error).toMatchObject({ reason: "exited" });
      expect(world.record).toBeUndefined();
    });

    it("fails with a timeout when the process lives but never answers", async () => {
      const world = new World();
      world.onLaunch = (record, w) => w.alive.add(record.pid);

      const error = await world
        .server()
        .start()
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ reason: "timeout" });
      expect(world.record).toBeUndefined();
    });

    it("stops the process it launched when it never became ready", async () => {
      const world = new World();
      world.onLaunch = (record, w) => w.alive.add(record.pid);

      await world
        .server()
        .start()
        .catch(() => undefined);

      expect(world.terminated).toEqual([100]);
    });

    it("reports what the cleanup of a failed start did", async () => {
      const world = new World();
      world.onLaunch = (record, w) => w.alive.add(record.pid);
      world.terminateResult = "failed";

      const error = await world
        .server()
        .start()
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ cleanup: { status: "failed" } });
    });

    it("fails when no port in range is free", async () => {
      const world = new World();
      world.ports = { isFree: async () => false };

      await expect(world.server().start()).rejects.toBeInstanceOf(NoFreePortError);
    });
  });

  describe("stop", () => {
    it("is not running when the directory has no record", async () => {
      const world = new World();

      await expect(world.server().stop()).resolves.toEqual({ result: "not-running" });
      expect(world.terminated).toEqual([]);
    });

    it("stops the recorded server", async () => {
      const world = new World();
      const { record } = await world.server().start();

      const stopped = await world.server().stop();

      expect(stopped.result).toBe("stopped");
      expect(world.terminated).toEqual([record.pid]);
    });

    it("asks the launcher to stop a recorded process even when it looks dead", async () => {
      const world = new World();
      world.record = { pid: 7, port: 8080, server_url: "http://localhost:8080" };

      await world.server().stop();

      expect(world.terminated).toEqual([7]);
    });

    it("is not running when the launcher finds nothing left to stop", async () => {
      const world = new World();
      world.record = { pid: 7, port: 8080, server_url: "http://localhost:8080" };
      world.terminateResult = "stale";

      await expect(world.server().stop()).resolves.toMatchObject({ result: "not-running" });
    });

    it("fails when the server does not stop", async () => {
      const world = new World();
      world.record = { pid: 7, port: 8080, server_url: "http://localhost:8080" };
      world.terminateResult = "failed";

      await expect(world.server().stop()).rejects.toBeInstanceOf(ServerStopError);
    });
  });
});

describe("chooseFreePort", () => {
  it("prefers the port it is given when it is free", async () => {
    await expect(chooseFreePort({ isFree: async () => true }, 9100)).resolves.toBe(9100);
  });

  it("starts from 8080 without a preference", async () => {
    await expect(chooseFreePort({ isFree: async () => true })).resolves.toBe(8080);
  });

  it("gives up after a hundred ports", async () => {
    const tried: number[] = [];
    const ports = {
      isFree: async (port: number) => {
        tried.push(port);
        return false;
      },
    };

    await expect(chooseFreePort(ports, 8080)).rejects.toBeInstanceOf(NoFreePortError);
    expect(tried).toHaveLength(100);
  });
});

import { describe, expect, it } from "vitest";

import { ManualClock } from "../../../../helpers/clock";

import {
  claimFreePort,
  Lifecycle,
  launched,
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
} from "../../../../../src/lib/local-server/internal/lifecycle";

type Fake = ServerRecord & { pid: number };

/** A machine with ports, processes and a store held in memory. */
class World {
  record: Fake | undefined;
  takenPorts = new Set<number>();
  alive = new Set<number>();
  /** Origins that answer /healthz, whoever answers them. */
  healthy = new Set<string>();
  launched: number[] = [];
  /** The recorded servers whose identity was asked about. */
  identityChecked: number[] = [];
  terminated: number[] = [];
  nextPid = 100;
  /** What `launch` does to the world, to model a process that dies or never answers. */
  onLaunch: (record: Fake, world: World) => void = (record, world) => {
    world.alive.add(record.pid);
    world.healthy.add(record.server_url);
  };
  terminateResult: StopOutcome["status"] = "stopped";
  /** What the server wrote; gone once it is cleaned up, as a container's log is. */
  logs = "";
  logsGone = false;

  /** Set to make the next writes of the record fail, as a full or read-only disk does. */
  writeError: Error | undefined;

  store: ServerStore<Fake> = {
    read: async () => this.record,
    write: async (record) => {
      if (this.writeError) {
        throw this.writeError;
      }
      this.record = record;
    },
  };

  launcher: Launcher<Fake> = {
    launch: async ({ port, serverUrl }) => {
      const record = { pid: this.nextPid++, port, server_url: serverUrl };
      this.launched.push(port);
      this.onLaunch(record, this);
      return launched(record);
    },
    isAlive: async (record) => {
      this.identityChecked.push(record.pid);
      return this.alive.has(record.pid);
    },
    isLaunchedAlive: async (server) => this.alive.has(server.pid),
    describe: (record) => ({ runtime: "fake", pid: record.pid }),
    logTail: async () => {
      if (this.logsGone) {
        throw new Error("no such container");
      }
      return this.logs;
    },
    terminate: async (record) => {
      this.terminated.push(record.pid);
      this.logsGone = true;
      if (this.terminateResult === "stopped") {
        this.alive.delete(record.pid);
        this.healthy.delete(record.server_url);
      }
      return { pid: record.pid, status: this.terminateResult };
    },
  };

  /** Ports another start has claimed but not yet bound. */
  reservedPorts = new Set<number>();
  released: number[] = [];

  ports: PortProbe = {
    isFree: async (port) => !this.takenPorts.has(port),
    reserve: async (port) => {
      if (this.reservedPorts.has(port)) {
        return undefined;
      }
      this.reservedPorts.add(port);
      return async () => {
        this.reservedPorts.delete(port);
        this.released.push(port);
      };
    },
  };
  health: HealthProbe = { isHealthy: async (url) => this.healthy.has(url) };

  server(options: ConstructorParameters<typeof Lifecycle<Fake>>[1] = {}) {
    return new Lifecycle<Fake>(
      { store: this.store, launcher: this.launcher, ports: this.ports, health: this.health },
      { startTimeoutMs: 30, pollIntervalMs: 5, clock: new ManualClock(), ...options },
    );
  }
}

describe("Lifecycle", () => {
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

    it("leaves a running server alone when the port it is asked to move to is held", async () => {
      const world = new World();
      await world.server().start();
      world.takenPorts.add(9000);

      await expect(world.server({ port: 9000 }).start()).rejects.toBeInstanceOf(PortInUseError);

      expect(world.terminated).toEqual([]);
      await expect(world.server().state()).resolves.toMatchObject({ kind: "running" });
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
      await expect(world.server().state()).resolves.toMatchObject({ kind: "dead" });
    });

    it("takes the next port when another start won the same port at the same moment", async () => {
      const world = new World();
      world.onLaunch = (record, w) => {
        if (record.port === 8080) {
          w.takenPorts.add(8080);
          return;
        }
        w.alive.add(record.pid);
        w.healthy.add(record.server_url);
      };

      const { record } = await world.server().start();

      expect(world.launched).toEqual([8080, 8081]);
      expect(record.port).toBe(8081);
    });

    it("does not retry a server that exited while its port was still free", async () => {
      const world = new World();
      world.onLaunch = () => undefined;

      await expect(world.server().start()).rejects.toMatchObject({ reason: "exited" });

      expect(world.launched).toEqual([8080]);
    });

    it("does not move to another port when one was asked for and lost", async () => {
      const world = new World();
      world.onLaunch = (record, w) => {
        w.takenPorts.add(record.port);
      };

      await expect(world.server({ port: 9000 }).start()).rejects.toMatchObject({
        reason: "exited",
      });

      expect(world.launched).toEqual([9000]);
    });

    it("keeps what the server logged, which cleaning up would remove", async () => {
      const world = new World();
      world.logs = "listen tcp :8080: bind: address already in use";
      world.onLaunch = () => undefined;

      await expect(world.server().start()).rejects.toMatchObject({
        reason: "exited",
        logTail: "listen tcp :8080: bind: address already in use",
      });
    });

    it("still reports a failed start when the log cannot be read", async () => {
      const world = new World();
      world.logsGone = true;
      world.onLaunch = () => undefined;

      await expect(world.server().start()).rejects.toMatchObject({
        reason: "exited",
        logTail: undefined,
      });
    });

    it("skips a port another start has claimed but not yet bound", async () => {
      const world = new World();
      world.reservedPorts.add(8080);

      const { record } = await world.server().start();

      expect(record.port).toBe(8081);
    });

    it("refuses a port that was asked for when another start has claimed it", async () => {
      const world = new World();
      world.reservedPorts.add(9000);

      await expect(world.server({ port: 9000 }).start()).rejects.toBeInstanceOf(PortInUseError);
    });

    it("lets go of its port claim once the server answers", async () => {
      const world = new World();

      await world.server().start();

      expect(world.released).toEqual([8080]);
    });

    it("lets go of its port claim when the start fails", async () => {
      const world = new World();
      world.onLaunch = () => undefined;

      await world
        .server()
        .start()
        .catch(() => undefined);

      expect(world.released).toEqual([8080]);
    });

    it("takes the next port when the launch itself fails because the port was taken", async () => {
      const world = new World();
      const launch = world.launcher.launch;
      world.launcher.launch = async (spec) => {
        if (spec.port === 8080) {
          world.takenPorts.add(8080);
          throw new Error("port is already allocated");
        }
        return launch(spec);
      };

      const { record } = await world.server().start();

      expect(record.port).toBe(8081);
    });

    it("stops the server it launched when its record cannot be written", async () => {
      const world = new World();
      world.writeError = new Error("read-only file system");

      await expect(world.server().start()).rejects.toThrow("read-only file system");

      expect(world.terminated).toEqual([100]);
      expect(world.alive.size).toBe(0);
    });

    it("does not launch another server when the record cannot be written", async () => {
      const world = new World();
      world.writeError = new Error("read-only file system");

      await world
        .server()
        .start()
        .catch(() => undefined);

      expect(world.launched).toEqual([8080]);
    });

    it("says so when the server it launched cannot be stopped after the record failed", async () => {
      const world = new World();
      world.writeError = new Error("read-only file system");
      world.terminateResult = "failed";

      await expect(world.server().start()).rejects.toBeInstanceOf(ServerStopError);
    });

    it("does not retry a launch that failed for another reason", async () => {
      const world = new World();
      world.launcher.launch = async () => {
        throw new Error("no such image");
      };

      await expect(world.server().start()).rejects.toThrow("no such image");
    });

    it("keeps the port the folder had under another backend", async () => {
      const world = new World();

      const { record } = await world.server({ previousPort: 8085 }).start();

      expect(record.port).toBe(8085);
    });

    it("does not ask who a server it has just launched is", async () => {
      const world = new World();

      await world.server().start();

      expect(world.identityChecked).toEqual([]);
    });

    it("tells a failed start what identifies the server", async () => {
      const world = new World();
      world.onLaunch = () => undefined;

      await expect(world.server().start()).rejects.toMatchObject({
        details: { runtime: "fake", pid: 100 },
      });
    });

    it("fails with a timeout when the process lives but never answers", async () => {
      const world = new World();
      world.onLaunch = (record, w) => w.alive.add(record.pid);

      const error = await world
        .server()
        .start()
        .catch((e: unknown) => e);

      expect(error).toMatchObject({ reason: "timeout" });
      await expect(world.server().state()).resolves.toMatchObject({ kind: "dead" });
    });

    it("records the server as soon as it is launched, so an interrupted start can still be stopped", async () => {
      const world = new World();
      let recordedWhileBooting: unknown;
      world.onLaunch = (record, w) => {
        w.alive.add(record.pid);
        w.health.isHealthy = async () => {
          recordedWhileBooting = w.record;
          return true;
        };
      };

      await world.server().start();

      expect(recordedWhileBooting).toMatchObject({ pid: 100, port: 8080 });
    });

    it("stops the server when checking on it throws", async () => {
      const world = new World();
      world.onLaunch = (record, w) => {
        w.alive.add(record.pid);
        w.health.isHealthy = async () => {
          throw new Error("probe failed");
        };
      };

      await expect(world.server().start()).rejects.toThrow("probe failed");

      expect(world.terminated).toEqual([100]);
    });

    it("keeps the reason a start failed when stopping the server fails too", async () => {
      const world = new World();
      world.onLaunch = (record, w) => w.alive.add(record.pid);
      world.launcher.terminate = async () => {
        throw new Error("docker daemon is gone");
      };

      await expect(world.server().start()).rejects.toMatchObject({
        reason: "timeout",
        cleanup: { status: "failed" },
      });
    });

    it("keeps the write error when stopping the server fails too", async () => {
      const world = new World();
      world.writeError = new Error("read-only file system");
      world.launcher.terminate = async () => {
        throw new Error("docker daemon is gone");
      };

      await expect(world.server().start()).rejects.toBeInstanceOf(ServerStopError);
    });

    it("does not let a claim that cannot be removed hide a successful start", async () => {
      const world = new World();
      world.ports.reserve = async () => async () => {
        throw new Error("EBUSY");
      };

      await expect(world.server().start()).resolves.toMatchObject({ alreadyRunning: false });
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
      world.ports = { isFree: async () => false, reserve: async () => async () => undefined };

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

describe("claimFreePort", () => {
  const open = (): PortProbe => ({
    isFree: async () => true,
    reserve: async () => async () => undefined,
  });

  it("prefers the port it is given when it is free", async () => {
    await expect(claimFreePort(open(), undefined, 9100)).resolves.toMatchObject({ port: 9100 });
  });

  it("starts from 8080 without a preference", async () => {
    await expect(claimFreePort(open())).resolves.toMatchObject({ port: 8080 });
  });

  it("takes a port that was asked for as it is", async () => {
    await expect(claimFreePort(open(), 9200, 9100)).resolves.toMatchObject({ port: 9200 });
  });

  describe("when another start binds a port between the look and the claim", () => {
    /** Free when first looked at, taken once anyone has claimed it, as after a start that bound it and let go. */
    const takenOnceClaimed = (claimed: number[]): PortProbe => ({
      isFree: async (port) => !claimed.includes(port),
      reserve: async (port) => {
        claimed.push(port);
        return async () => undefined;
      },
    });

    it("skips an automatic port and takes the next", async () => {
      const claimed: number[] = [];
      let released = 0;
      const ports: PortProbe = {
        isFree: async (port) => port !== 8080 || claimed.length === 0,
        reserve: async (port) => {
          claimed.push(port);
          return async () => {
            released++;
          };
        },
      };

      await expect(claimFreePort(ports, undefined, 8080)).resolves.toMatchObject({ port: 8081 });
      expect(released).toBe(1);
    });

    it("refuses a port that was asked for", async () => {
      await expect(claimFreePort(takenOnceClaimed([]), 9200)).rejects.toBeInstanceOf(
        PortInUseError,
      );
    });

    it("releases the claim on a port that was asked for and refused", async () => {
      let released = 0;
      const ports: PortProbe = {
        isFree: async () => false,
        reserve: async () => async () => {
          released++;
        },
      };

      await claimFreePort(ports, 9200).catch(() => undefined);

      expect(released).toBe(1);
    });
  });

  it("gives up after a hundred ports", async () => {
    const tried: number[] = [];
    const ports: PortProbe = {
      isFree: async (port) => {
        tried.push(port);
        return false;
      },
      reserve: async () => async () => undefined,
    };

    await expect(claimFreePort(ports, undefined, 8080)).rejects.toBeInstanceOf(NoFreePortError);
    expect(tried).toHaveLength(100);
  });
});

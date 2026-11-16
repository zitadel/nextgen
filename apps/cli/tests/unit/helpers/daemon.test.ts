import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { basename } from "node:path";

import { describe, expect, onTestFinished } from "vitest";

import { it } from "@tests/helpers/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

const LISTEN = "require('node:net').createServer().listen(Number(process.argv[1]), '127.0.0.1')";
const STAY = "setInterval(() => undefined, 1000)";
const SAY_READY = `console.log('ready'); ${STAY}`;

/**
 * Whether anything runs under the id.
 *
 * @param pid - The process id.
 * @returns Whether it can be signalled.
 */
const runs = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("daemon", () => {
  describe("spawn", () => {
    it("returns once the output says it is ready", async ({ daemon }) => {
      const started = await daemon.spawn(process.execPath, ["-e", SAY_READY], { ready: /ready/ });

      expect(started.output()).toContain("ready");
    });

    it("returns once a port accepts a connection", async ({ daemon, port }) => {
      const started = await daemon.spawn(
        process.execPath,
        ["-e", `${LISTEN}; ${STAY}`, String(port)],
        { ready: { port } },
      );

      expect(runs(started.pid)).toBe(true);
    });

    it("returns once the process exists when nothing is waited for", async ({ daemon }) => {
      const started = await daemon.spawn(process.execPath, ["-e", STAY]);

      expect(runs(started.pid)).toBe(true);
    });

    it("runs the process where it is told to", async ({ daemon, dir }) => {
      const started = await daemon.spawn(process.execPath, ["-e", "console.log(process.cwd())"], {
        cwd: dir,
        ready: /\S/,
      });

      expect(started.output()).toContain(basename(dir));
    });

    it("keeps what the process wrote to stderr", async ({ daemon }) => {
      const started = await daemon.spawn(
        process.execPath,
        ["-e", `console.error('oops'); ${STAY}`],
        { ready: /oops/ },
      );

      expect(started.output()).toContain("oops");
    });

    it("refuses a process that exits before it is ready, with what it wrote", async ({
      daemon,
    }) => {
      const refusal = await rejectionOf(() => {
        return daemon.spawn(process.execPath, ["-e", "console.log('boom'); process.exit(1)"], {
          ready: /never/,
        });
      });

      expect(refusal).toBeInstanceOf(Error);
      expect(refusal).toMatchObject({ message: expect.stringContaining("boom") });
    });

    it("refuses a program that cannot be started", async ({ daemon }) => {
      const refusal = await rejectionOf(() => {
        return daemon.spawn("/nonexistent/program", []);
      });

      expect(refusal).toMatchObject({ code: "ENOENT" });
    });

    it("puts the process in a group of its own", async ({ daemon }) => {
      const started = await daemon.spawn(process.execPath, ["-e", STAY]);

      expect(process.kill(-started.pid, 0)).toBe(true);
    });
  });

  describe("stop", () => {
    it("ends the process", async ({ daemon }) => {
      const started = await daemon.spawn(process.execPath, ["-e", STAY]);

      await started.stop();

      expect(runs(started.pid)).toBe(false);
    });

    it("ends a process that ignores the first signal", async ({ daemon }) => {
      const started = await daemon.spawn(
        process.execPath,
        ["-e", `process.on('SIGTERM', () => undefined); console.log('ready'); ${STAY}`],
        { ready: /ready/ },
      );

      await started.stop();

      expect(runs(started.pid)).toBe(false);
    });

    it("has nothing to do for a process that already exited", async ({ daemon }) => {
      const started = await daemon.spawn(process.execPath, ["-e", "console.log('bye')"], {
        ready: /bye/,
      });
      await started.stop();

      await expect(started.stop()).resolves.toBeUndefined();
    });
  });

  describe("when the test ends", () => {
    it("ends the process it spawned", async ({ daemon }) => {
      const started = await daemon.spawn(process.execPath, ["-e", STAY]);
      onTestFinished(() => {
        expect(runs(started.pid)).toBe(false);
      });

      expect(runs(started.pid)).toBe(true);
    });

    it("ends the process the code under test started", ({ daemon }) => {
      const child = spawn(process.execPath, ["-e", STAY], { detached: true, stdio: "ignore" });
      child.unref();
      const { pid } = child;
      if (pid === undefined) {
        throw new Error("the process did not start");
      }
      daemon.adopt(pid);
      onTestFinished(() => {
        expect(runs(pid)).toBe(false);
      });

      expect(runs(pid)).toBe(true);
    });

    it.for([0, -1, 1.5, Number.NaN])("refuses %s as a process id to adopt", (pid, { daemon }) => {
      expect(() => {
        daemon.adopt(pid);
      }).toThrow("is not a process id");
    });

    it("ends the process a log names", async ({ daemon }) => {
      const child = spawn(process.execPath, ["-e", STAY], { detached: true, stdio: "ignore" });
      child.unref();
      const { pid } = child;
      if (pid === undefined) {
        throw new Error("the process did not start");
      }
      await writeFile(daemon.pidLog(), `${String(pid)}\n`);
      onTestFinished(() => {
        expect(runs(pid)).toBe(false);
      });

      expect(runs(pid)).toBe(true);
    });
  });
});

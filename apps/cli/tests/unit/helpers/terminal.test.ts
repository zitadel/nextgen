import { Readable } from "node:stream";

import { describe, expect } from "vitest";

import { it } from "@tests/fixtures";

const found = {
  platform: process.platform,
  columns: process.stdout.columns,
  isTTY: process.stdout.isTTY,
  stdin: process.stdin,
};

describe("terminal", () => {
  describe("while the test runs", () => {
    it("puts stdout at a terminal", ({ terminal }) => {
      expect(terminal.keyboard).toBe(process.stdin);
      expect(process.stdout.isTTY).toBe(true);
    });

    it("keeps what the run drew, as written", ({ terminal }) => {
      process.stdout.write("\u001b[32mdrawn\u001b[39m");

      expect(terminal.shown()).toBe("\u001b[32mdrawn\u001b[39m");
    });

    it("keeps what the run drew, without its colour", ({ terminal }) => {
      process.stdout.write("\u001b[32mdrawn\u001b[39m");

      expect(terminal.plain()).toBe("drawn");
    });

    it("keeps what the run wrote to stderr", ({ terminal }) => {
      process.stderr.write("failed");

      expect(terminal.errors()).toBe("failed");
    });

    it("types at the keyboard the run reads", async ({ terminal }) => {
      const read = new Promise<string>((resolve) => {
        process.stdin.once("data", (chunk: Buffer) => resolve(chunk.toString()));
      });

      terminal.keyboard.write("y");

      await expect(read).resolves.toBe("y");
    });

    it("keeps the raw modes the keyboard was put in", ({ terminal }) => {
      process.stdin.setRawMode(true);

      expect(terminal.rawModes()).toEqual([true]);
    });

    it("pipes a value into stdin", async ({ terminal }) => {
      terminal.stdin("piped\n");

      const chunks: string[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(String(chunk));
      }

      expect(chunks.join("")).toBe("piped\n");
    });

    it("uses a stream handed to it as stdin", async ({ terminal }) => {
      const stream = Readable.from(["streamed\n"]);
      terminal.stdin(stream);

      const chunks: string[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(String(chunk));
      }

      expect(process.stdin).toBe(stream);
      expect(chunks.join("")).toBe("streamed\n");
    });

    it("makes a stream handed to it report it is not a terminal", ({ terminal }) => {
      terminal.stdin(Readable.from([]));

      expect(process.stdin.isTTY).toBe(false);
    });

    it("makes a piped stdin report it is not a terminal", ({ terminal }) => {
      terminal.stdin("piped\n");

      expect(process.stdin.isTTY).toBe(false);
    });

    it("turns stdout's terminal off", ({ terminal }) => {
      terminal.tty(false);

      expect(process.stdout.isTTY).toBe(false);
    });

    it("sets how wide stdout is", ({ terminal }) => {
      terminal.columns(30);

      expect(process.stdout.columns).toBe(30);
    });

    it("sets the platform the process reports", ({ terminal }) => {
      terminal.platform("win32");

      expect(process.platform).toBe("win32");
    });
  });

  describe("once the test is over", () => {
    it("changes what a test may change", ({ terminal }) => {
      terminal.stdin("piped\n");
      terminal.tty(false);
      terminal.columns(30);
      terminal.platform("win32");

      expect(process.platform).toBe("win32");
    });

    it("gives the platform back", () => {
      expect(process.platform).toBe(found.platform);
    });

    it("gives stdout's width back", () => {
      expect(process.stdout.columns).toBe(found.columns);
    });

    it("gives stdout's terminal back", () => {
      expect(process.stdout.isTTY).toBe(found.isTTY);
    });

    it("gives stdin back", () => {
      expect(process.stdin).toBe(found.stdin);
    });
  });
});

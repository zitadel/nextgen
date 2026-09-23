import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import { readKeys } from "../../../../src/lib/run/keys";

/** A stdin stand-in that records the terminal-mode calls the reader makes. */
class FakeStdin extends EventEmitter {
  isRaw = false;
  paused = false;
  readonly rawModeCalls: boolean[] = [];

  constructor(public isTTY = true) {
    super();
  }

  setRawMode(raw: boolean): this {
    this.rawModeCalls.push(raw);
    this.isRaw = raw;
    return this;
  }

  setEncoding(): this {
    return this;
  }

  resume(): this {
    this.paused = false;
    return this;
  }

  pause(): this {
    this.paused = true;
    return this;
  }

  off(event: string, listener: (...args: never[]) => void): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }
}

function reader(stdin: FakeStdin) {
  const keys: string[] = [];
  let quits = 0;
  const handle = readKeys({
    stdin: stdin as unknown as NodeJS.ReadStream,
    onKey: (key) => keys.push(key),
    onQuit: () => {
      quits += 1;
    },
  });
  return { handle, keys, quits: () => quits };
}

describe("readKeys", () => {
  it("reports each keypress without waiting for Enter", () => {
    const stdin = new FakeStdin();
    const { keys } = reader(stdin);

    stdin.emit("data", "r");
    stdin.emit("data", "R");

    expect(keys).toEqual(["r", "R"]);
  });

  it("reads every key of a chunk that arrived at once", () => {
    const stdin = new FakeStdin();
    const { keys } = reader(stdin);

    stdin.emit("data", "rR");

    expect(keys).toEqual(["r", "R"]);
  });

  it("turns Ctrl-C into a quit, which raw mode would otherwise swallow", () => {
    const stdin = new FakeStdin();
    const { keys, quits } = reader(stdin);

    stdin.emit("data", "");

    expect(quits()).toBe(1);
    expect(keys).toEqual([]);
  });

  it("treats Ctrl-D as a quit too", () => {
    const stdin = new FakeStdin();
    const { quits } = reader(stdin);

    stdin.emit("data", "");

    expect(quits()).toBe(1);
  });

  it("stops reading the rest of a chunk once it holds a quit", () => {
    const stdin = new FakeStdin();
    const { keys, quits } = reader(stdin);

    stdin.emit("data", "rr");

    expect(keys).toEqual(["r"]);
    expect(quits()).toBe(1);
  });

  it("restores the terminal mode it found, so the shell keeps echoing", () => {
    const stdin = new FakeStdin();
    const { handle } = reader(stdin);

    expect(stdin.rawModeCalls).toEqual([true]);

    handle?.stop();

    expect(stdin.rawModeCalls).toEqual([true, false]);
    expect(stdin.listenerCount("data")).toBe(0);
    expect(stdin.paused).toBe(true);
  });

  it("restores the terminal only once", () => {
    const stdin = new FakeStdin();
    const { handle } = reader(stdin);

    handle?.stop();
    handle?.stop();

    expect(stdin.rawModeCalls).toEqual([true, false]);
  });

  it("reads nothing when stdin is not a terminal", () => {
    const stdin = new FakeStdin(false);
    const { handle } = reader(stdin);

    expect(handle).toBeUndefined();
    expect(stdin.rawModeCalls).toEqual([]);
  });
});

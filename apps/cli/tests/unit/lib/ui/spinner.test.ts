import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => (await import("@tests/helpers/clack")).clackDouble());

import { spinner } from "@clack/prompts";

import { DrawnSpinner, QuietSpinner, type Spinner } from "@/lib/ui/spinner";

/** The handle clack handed back to the last spinner that was started. */
const handle = () => vi.mocked(spinner).mock.results.at(-1)?.value as ReturnType<typeof spinner>;

/** A terminal to read keys from, `isTTY` or not. */
const terminal = (isTTY: boolean): EventEmitter & { isTTY: boolean } => {
  return Object.assign(new EventEmitter(), { isTTY });
};

/** A terminal to draw on that keeps what was written to it, as `written()`. */
const screen = (): Writable & { isTTY: boolean; written(): string } => {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return Object.assign(stream, {
    isTTY: true,
    written: () => {
      return chunks.join("");
    },
  });
};

/** Runs `act` and returns how many SIGINTs reached the process meanwhile. */
const interrupts = (act: () => void): number => {
  let count = 0;
  const listener = (): void => {
    count += 1;
  };
  process.on("SIGINT", listener);
  try {
    act();
  } finally {
    process.off("SIGINT", listener);
  }
  return count;
};

afterEach(() => {
  vi.clearAllMocks();
  // A spinner no test stopped must not be drawn again by the next test's line.
  DrawnSpinner.active.clear();
});

describe("DrawnSpinner", () => {
  it("is spinning as soon as it exists, under the label it was given", () => {
    new DrawnSpinner("Fetching users");

    expect(handle().start).toHaveBeenCalledWith("Fetching users");
  });

  it("runs in the chain's gutter unless it is told not to", () => {
    new DrawnSpinner("Fetching users");

    expect(spinner).toHaveBeenCalledWith(expect.objectContaining({ withGuide: true }));
  });

  it("stays out of the gutter for work that clears itself", () => {
    // A cleared spinner that drew a guide line leaves that line behind.
    new DrawnSpinner("Checking for a local Zitadel server", false);

    expect(spinner).toHaveBeenCalledWith(expect.objectContaining({ withGuide: false }));
  });

  it("raises Ctrl-C, a key in raw mode, as SIGINT", () => {
    const input = terminal(true);
    new DrawnSpinner("Creating the project", true, input);

    expect(interrupts(() => input.emit("data", Buffer.from("\u0003")))).toBe(1);
  });

  it("raises nothing for any other key", () => {
    const input = terminal(true);
    new DrawnSpinner("Creating the project", true, input);

    expect(interrupts(() => input.emit("data", Buffer.from("q")))).toBe(0);
  });

  it("takes off the key handler clack added, which exits 0 on Ctrl-C", () => {
    const input = terminal(true);
    const clacks = vi.mocked(spinner).getMockImplementation();
    vi.mocked(spinner).mockImplementationOnce((options) => {
      input.on("keypress", () => undefined);
      return clacks?.(options) as ReturnType<typeof spinner>;
    });

    new DrawnSpinner("Creating the project", true, input);

    expect(input.listenerCount("keypress")).toBe(0);
  });

  it("stops reading keys once it is cleared", () => {
    const input = terminal(true);
    new DrawnSpinner("Creating the project", true, input).clear();

    expect(input.listenerCount("data")).toBe(0);
  });

  it("stops reading keys once it is stopped", () => {
    const input = terminal(true);
    new DrawnSpinner("Creating the project", true, input).stop("Created");

    expect(input.listenerCount("data")).toBe(0);
  });

  it("registers one SIGTERM listener of its own, however many spinners start", () => {
    const hooks = DrawnSpinner as unknown as { exitHooked: boolean };
    hooks.exitHooked = false;
    const before = new Set(process.listeners("SIGTERM"));

    new DrawnSpinner("Fetching users");
    new DrawnSpinner("Fetching groups");

    const added = process.listeners("SIGTERM").filter((listener) => {
      return !before.has(listener);
    });
    for (const listener of added) {
      process.removeListener("SIGTERM", listener);
    }
    expect(added).toHaveLength(1);
  });

  it("reads nothing from a stream that is not a terminal", () => {
    const input = terminal(false);
    new DrawnSpinner("Creating the project", true, input);

    expect(input.listenerCount("data")).toBe(0);
  });

  it("renames itself while the work goes on", () => {
    new DrawnSpinner("Fetching users").message("Fetching users — page 2");

    expect(handle().message).toHaveBeenCalledWith("Fetching users — page 2");
  });

  it("leaves a line when it is stopped", () => {
    new DrawnSpinner("Fetching users").stop("Fetched 3 users");

    expect(handle().stop).toHaveBeenCalledWith("Fetched 3 users");
  });

  it("leaves nothing behind when it is cleared", () => {
    new DrawnSpinner("Fetching users").clear();

    expect(handle().clear).toHaveBeenCalled();
  });
});

describe("DrawnSpinner.around", () => {
  it("clears a running spinner before the line and draws it again after", () => {
    const order: string[] = [];
    const running = new DrawnSpinner("Deploying");
    vi.mocked(handle().clear).mockImplementation(() => void order.push("clear"));

    DrawnSpinner.around(() => order.push("line"));

    expect(order).toEqual(["clear", "line"]);
    expect(handle().start).toHaveBeenCalledWith("Deploying");
    expect(vi.mocked(spinner)).toHaveBeenCalledTimes(2);
    running.clear();
  });

  it("draws it again under the name it was last given", () => {
    const running = new DrawnSpinner("Deploying");
    running.message("Deploying — 2 of 3");

    DrawnSpinner.around(() => undefined);

    expect(handle().start).toHaveBeenCalledWith("Deploying — 2 of 3");
    running.clear();
  });

  it("starts nothing when no spinner is running", () => {
    DrawnSpinner.around(() => undefined);

    expect(spinner).not.toHaveBeenCalled();
  });

  it("erases the guide line a running spinner drew, so a pause adds no empty line", () => {
    const output = screen();
    const running = new DrawnSpinner("Deploying", true, terminal(true), output);

    DrawnSpinner.around(() => undefined);

    expect(output.written()).toBe("\u001b[1A\u001b[0J");
    running.clear();
  });

  it("erases no line above a spinner kept out of the gutter", () => {
    const output = screen();
    const running = new DrawnSpinner("Checking", false, terminal(true), output);

    DrawnSpinner.around(() => undefined);

    expect(output.written()).toBe("");
    running.clear();
  });

  it("does not read keys while it is paused", () => {
    const input = terminal(true);
    const running = new DrawnSpinner("Deploying", true, input, screen());

    DrawnSpinner.around(() => {
      expect(input.listenerCount("data")).toBe(0);
    });

    running.clear();
  });

  it("does not bring back a spinner stopped while it was paused", () => {
    const running = new DrawnSpinner("Deploying");
    const resume = DrawnSpinner.pause();
    running.stop("Deployed");
    vi.mocked(spinner).mockClear();

    resume();

    expect(spinner).not.toHaveBeenCalled();
  });

  it("does not bring back a spinner that has stopped", () => {
    new DrawnSpinner("Deploying").stop("Deployed");
    vi.mocked(spinner).mockClear();

    DrawnSpinner.around(() => undefined);

    expect(spinner).not.toHaveBeenCalled();
  });
});

describe("DrawnSpinner.clearAll", () => {
  it("clears a spinner nobody ended", () => {
    new DrawnSpinner("Committing");

    DrawnSpinner.clearAll();

    expect(handle().clear).toHaveBeenCalled();
  });

  it("leaves nothing for a later line to draw again", () => {
    new DrawnSpinner("Committing");
    DrawnSpinner.clearAll();
    vi.mocked(spinner).mockClear();

    DrawnSpinner.around(() => undefined);

    expect(spinner).not.toHaveBeenCalled();
  });
});

describe("QuietSpinner", () => {
  it("draws nothing, whatever it is asked to do", () => {
    const quiet: Spinner = new QuietSpinner();
    quiet.message("Fetching users — page 2");
    quiet.stop("Fetched 3 users");
    quiet.clear();

    expect(spinner).not.toHaveBeenCalled();
  });
});

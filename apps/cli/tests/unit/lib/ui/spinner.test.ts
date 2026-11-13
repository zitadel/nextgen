import { PassThrough } from "node:stream";
import { stripVTControlCharacters as plain } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DrawnSpinner, QuietSpinner, type Spinner } from "@/lib/ui/spinner";
import { atTerminal } from "@tests/helpers/keyboard";

/** What clack writes as a spinner starts, and as it ends. */
const HIDE_CURSOR = "\u001b[?25l";

/** The guide clack draws above a spinner that sits in a chain's gutter. */
const GUIDE_LINE = "│\n";

/** A stream that is not a terminal, as a pipe is: it has no `isTTY` and no raw mode. */
const pipe = (): PassThrough => new PassThrough();

/** Runs `act` and returns how many SIGINTs reached the process meanwhile. */
const interrupts = (act: () => void): number => {
  const heard: string[] = [];
  const listener = (): void => {
    heard.push("SIGINT");
  };
  process.on("SIGINT", listener);
  try {
    act();
  } finally {
    process.off("SIGINT", listener);
  }
  return heard.length;
};

/** How long clack waits between one frame of a spinner and the next. */
const FRAME = 100;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  // A spinner no test stopped must not be drawn again by the next test's line.
  DrawnSpinner.active.clear();
});

describe("DrawnSpinner", () => {
  it("is spinning as soon as it exists", () => {
    const screen = atTerminal();

    new DrawnSpinner("Fetching users");

    expect(screen.shown().startsWith(HIDE_CURSOR)).toBe(true);
    expect(DrawnSpinner.active.size).toBe(1);
  });

  it("runs in the chain's gutter unless it is told not to", () => {
    const screen = atTerminal();

    new DrawnSpinner("Fetching users");

    expect(plain(screen.shown())).toContain(GUIDE_LINE);
  });

  it("stays out of the gutter for work that clears itself", () => {
    // A cleared spinner that drew a guide line leaves that line behind.
    const screen = atTerminal();

    new DrawnSpinner("Checking for a local Zitadel server", false);

    expect(plain(screen.shown())).not.toContain(GUIDE_LINE);
  });

  it("raises Ctrl-C, a key in raw mode, as SIGINT", () => {
    const screen = atTerminal();
    new DrawnSpinner("Creating the project");

    expect(interrupts(() => screen.keyboard.emit("data", Buffer.from("\u0003")))).toBe(1);
  });

  it("raises nothing for any other key", () => {
    const screen = atTerminal();
    new DrawnSpinner("Creating the project");

    expect(interrupts(() => screen.keyboard.emit("data", Buffer.from("q")))).toBe(0);
  });

  it("takes off the key handler clack added, which exits 0 on Ctrl-C", () => {
    const screen = atTerminal();

    new DrawnSpinner("Creating the project");

    expect(screen.keyboard.listenerCount("keypress")).toBe(0);
  });

  it("stops reading keys once it is cleared", () => {
    const screen = atTerminal();
    new DrawnSpinner("Creating the project").clear();

    expect(interrupts(() => screen.keyboard.emit("data", Buffer.from("\u0003")))).toBe(0);
  });

  it("stops reading keys once it is stopped", () => {
    const screen = atTerminal();
    new DrawnSpinner("Creating the project").stop("Created");

    expect(interrupts(() => screen.keyboard.emit("data", Buffer.from("\u0003")))).toBe(0);
  });

  it("registers one SIGTERM listener of its own, however many spinners start", () => {
    atTerminal();
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
    atTerminal();
    const input = pipe();
    new DrawnSpinner("Creating the project", true, input);

    expect(input.listenerCount("data")).toBe(0);
  });

  it("renames itself while the work goes on", () => {
    vi.useFakeTimers();
    const screen = atTerminal();
    const running = new DrawnSpinner("Fetching users");

    running.message("Fetching users — page 2");
    vi.advanceTimersByTime(FRAME);

    expect(plain(screen.shown())).toContain("Fetching users — page 2");
    running.clear();
  });

  it("leaves a line when it is stopped", () => {
    const screen = atTerminal();

    new DrawnSpinner("Fetching users").stop("Fetched 3 users");

    expect(plain(screen.shown())).toContain("Fetched 3 users");
  });

  it("leaves nothing behind when it is cleared", () => {
    const screen = atTerminal();
    const running = new DrawnSpinner("Fetching users");
    const before = plain(screen.shown());

    running.clear();

    expect(plain(screen.shown())).toBe(before);
    expect(DrawnSpinner.active.size).toBe(0);
  });
});

describe("DrawnSpinner.around", () => {
  it("clears a running spinner before the line and draws it again after", () => {
    const screen = atTerminal();
    const running = new DrawnSpinner("Deploying");
    const started = screen.shown().split(HIDE_CURSOR).length;

    DrawnSpinner.around(() => {
      process.stdout.write("a line\n");
    });

    const after = screen.shown().split("a line\n");
    expect(after[1]?.includes(HIDE_CURSOR)).toBe(true);
    expect(after[0]?.split(HIDE_CURSOR).length).toBe(started);
    running.clear();
  });

  it("draws it again under the name it was last given", () => {
    vi.useFakeTimers();
    const screen = atTerminal();
    const running = new DrawnSpinner("Deploying");
    running.message("Deploying — 2 of 3");

    DrawnSpinner.around(() => undefined);
    const before = plain(screen.shown()).split("Deploying — 2 of 3").length;
    vi.advanceTimersByTime(FRAME);

    expect(plain(screen.shown()).split("Deploying — 2 of 3").length).toBeGreaterThan(before);
    running.clear();
  });

  it("starts nothing when no spinner is running", () => {
    const screen = atTerminal();

    DrawnSpinner.around(() => undefined);

    expect(screen.shown()).toBe("");
  });

  it("erases the guide line a running spinner drew, so a pause adds no empty line", () => {
    const screen = atTerminal();
    const running = new DrawnSpinner("Deploying");
    const before = screen.shown().length;

    const resume = DrawnSpinner.pause();

    expect(screen.shown().slice(before)).toContain("\u001b[1A\u001b[0J");
    resume();
    running.clear();
  });

  it("erases no line above a spinner kept out of the gutter", () => {
    const screen = atTerminal();
    const running = new DrawnSpinner("Checking", false);
    const before = screen.shown().length;

    const resume = DrawnSpinner.pause();

    expect(screen.shown().slice(before)).not.toContain("\u001b[1A");
    resume();
    running.clear();
  });

  it("does not read keys while it is paused", () => {
    const screen = atTerminal();
    const running = new DrawnSpinner("Deploying");

    const heard = interrupts(() => {
      DrawnSpinner.around(() => screen.keyboard.emit("data", Buffer.from("\u0003")));
    });

    expect(heard).toBe(0);
    running.clear();
  });

  it("does not bring back a spinner stopped while it was paused", () => {
    const screen = atTerminal();
    const running = new DrawnSpinner("Deploying");
    const resume = DrawnSpinner.pause();
    running.stop("Deployed");
    const before = screen.shown().split(HIDE_CURSOR).length;

    resume();

    expect(screen.shown().split(HIDE_CURSOR).length).toBe(before);
  });

  it("does not bring back a spinner that has stopped", () => {
    const screen = atTerminal();
    new DrawnSpinner("Deploying").stop("Deployed");
    const before = screen.shown().length;

    DrawnSpinner.around(() => undefined);

    expect(screen.shown().length).toBe(before);
  });
});

describe("a terminal given back", () => {
  // Clack never leaves raw mode on win32, so Ctrl-C stays a key nobody reads.
  it.each([
    ["cleared", (running: DrawnSpinner) => running.clear()],
    ["stopped", (running: DrawnSpinner) => running.stop("Done")],
    ["paused", () => DrawnSpinner.pause()],
  ])("is cooked again once the spinner is %s", (_how, end) => {
    const screen = atTerminal();
    const running = new DrawnSpinner("Installing");

    end(running);

    expect(screen.rawModes().at(-1)).toBe(false);
  });

  it("is left alone when it is not a terminal", () => {
    atTerminal();
    const input = pipe();
    const raw = vi.fn();
    Object.assign(input, { setRawMode: raw });

    new DrawnSpinner("Installing", true, input).clear();

    expect(raw).not.toHaveBeenCalled();
  });
});

describe("a spinner stopped while paused", () => {
  it("still leaves its line once the pause is over", () => {
    const screen = atTerminal();
    const running = new DrawnSpinner("Deploying");
    const resume = DrawnSpinner.pause();

    running.stop("Deployed");
    resume();

    expect(plain(screen.shown())).toContain("Deployed");
  });

  it("leaves the label it started with when it was given no text", () => {
    const screen = atTerminal();
    const running = new DrawnSpinner("Deploying");
    const resume = DrawnSpinner.pause();

    running.stop();
    resume();

    expect(plain(screen.shown())).toContain("Deploying");
  });

  it("leaves nothing for one that was cleared", () => {
    const screen = atTerminal();
    const running = new DrawnSpinner("Deploying");
    const resume = DrawnSpinner.pause();
    const before = screen.shown();

    running.clear();
    resume();

    expect(screen.shown()).toBe(before);
  });
});

describe("DrawnSpinner on a CI terminal", () => {
  // Clack leaves its frame line behind there and ends it with a newline, so
  // the guide is two lines up, not one.
  it("erases the guide line two lines up", () => {
    vi.stubEnv("CI", "true");
    const screen = atTerminal();
    const running = new DrawnSpinner("Deploying");
    const before = screen.shown().length;

    DrawnSpinner.around(() => undefined);

    expect(screen.shown().slice(before)).toContain("\u001b[2A\u001b[0J");
    running.clear();
  });
});

describe("DrawnSpinner.clearAll", () => {
  it("clears a spinner nobody ended", () => {
    atTerminal();
    new DrawnSpinner("Committing");

    DrawnSpinner.clearAll();

    expect(DrawnSpinner.active.size).toBe(0);
  });

  it("leaves nothing for a later line to draw again", () => {
    const screen = atTerminal();
    new DrawnSpinner("Committing");
    DrawnSpinner.clearAll();
    const before = screen.shown().length;

    DrawnSpinner.around(() => undefined);

    expect(screen.shown().length).toBe(before);
  });
});

describe("QuietSpinner", () => {
  it("draws nothing, whatever it is asked to do", () => {
    const screen = atTerminal();
    const quiet: Spinner = new QuietSpinner();
    quiet.message("Fetching users — page 2");
    quiet.stop("Fetched 3 users");
    quiet.clear();

    expect(screen.shown()).toBe("");
  });
});

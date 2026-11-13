import { syncBuiltinESMExports } from "node:module";
import { PassThrough } from "node:stream";
import { stripVTControlCharacters } from "node:util";

import { onTestFinished } from "vitest";

/** The key a person presses to walk away from a prompt. */
const CTRL_C = "\u0003";

/** Erases what is typed on the line so far, which is how a prefilled answer is replaced. */
const CTRL_U = "\u0015";

const DOWN = "\u001b[B";
const ENTER = "\r";
const SPACE = " ";

/** What clack writes as a prompt starts, just ahead of its first frame. */
const HIDE_CURSOR = "\u001b[?25l";

/** What clack writes as a prompt ends, whether it was answered or walked away from. */
const SHOW_CURSOR = "\u001b[?25h";

/** The widest a terminal can be, so no question or choice ever wraps. */
const COLUMNS = 10_000;

/** What a person picks at a multiselect, or types at a text, as the test scripts it. */
export type Answer = string | boolean | readonly string[];

/**
 * One question as a person saw it on screen: what was asked, and the choices
 * under it, if it was a choice.
 */
export interface Seen {
  question: string;
  choices: string[];
}

/** A prompt's choices and where the cursor stands, read from what it drew. */
interface Drawn extends Seen {
  active: number;
}

/**
 * The line of one choice: its marker, then its label, then a hint in
 * brackets if it has one. Any of the four markers clack draws a choice with.
 */
const CHOICE = /^(?<marker>[●○◼◻])\s+(?<label>(?:(?!\s\/\s[●○]).)*?)(?:\s+\([^)]*\))?$/u;

/** What clack draws down the left of a prompt in a chain: its guide and its mark. */
const GUIDE = /^[│└┌◆◇■▲]\s*/u;

/** Reads what a prompt drew in its first frame, the way a person reads the screen. */
function read(frame: string): Drawn {
  const lines = stripVTControlCharacters(frame)
    .split("\n")
    .map((line) => {
      return line.replace(GUIDE, "").trim();
    })
    .filter((line) => {
      return line !== "";
    });
  const first = lines.findIndex((line) => {
    return CHOICE.test(line);
  });
  if (first <= 0) {
    return { question: lines.at(0) ?? "", choices: [], active: 0 };
  }
  const matches = lines
    .slice(first)
    .map((line) => {
      return CHOICE.exec(line);
    })
    .filter((match) => {
      return match?.groups !== undefined;
    });
  return {
    question: lines.slice(0, first).join(" "),
    choices: matches.map((match) => {
      return match?.groups?.label ?? "";
    }),
    active: Math.max(
      0,
      matches
        .map((match) => {
          return match?.groups?.marker === "●";
        })
        .lastIndexOf(true),
    ),
  };
}

/**
 * The keys a person presses to give `answer` to a prompt that drew `drawn`.
 *
 * - A boolean answers a choice of "Yes" and "No".
 * - A string picks the choice that has that text, or is typed where the prompt
 *   has no choices.
 * - A list ticks each of the choices that have that text.
 * - Anything else is a person walking away.
 */
function keysFor(drawn: Drawn, answer: Answer | undefined): string {
  if (answer === undefined) {
    return CTRL_C;
  }
  const { choices, active } = drawn;
  const ofLabel = (wanted: string): number => {
    const exact = choices.indexOf(wanted);
    return exact >= 0 ? exact : choices.findIndex((label) => label.includes(wanted));
  };
  if (typeof answer === "boolean" && choices.length === 0) {
    return answer ? "y" : "n";
  }
  if (typeof answer === "boolean") {
    const at = ofLabel(answer ? "Yes" : "No");
    return at < 0 ? CTRL_C : DOWN.repeat((at - active + choices.length) % choices.length) + ENTER;
  }
  if (typeof answer === "string") {
    if (choices.length === 0) {
      return CTRL_U + answer + ENTER;
    }
    const at = ofLabel(answer);
    return at < 0 ? CTRL_C : DOWN.repeat((at - active + choices.length) % choices.length) + ENTER;
  }
  const stops = answer.map((wanted) => {
    return ofLabel(wanted);
  });
  if (stops.some((at) => at < 0)) {
    return CTRL_C;
  }
  const keys = stops.map((at, index) => {
    const cursor = index === 0 ? active : (stops[index - 1] ?? active);
    return DOWN.repeat((at - cursor + choices.length) % choices.length) + SPACE;
  });
  return keys.join("") + ENTER;
}

/** The terminal a test's run is at: its keyboard, and what has been drawn on its screen. */
export interface Terminal {
  /** The stream the keys go in at. It is the process's stdin for as long as the test runs. */
  keyboard: PassThrough;
  /** Every raw mode the keyboard was put in, in order. */
  rawModes(): boolean[];
  /** Everything the run drew, as written, colour and cursor codes included. */
  shown(): string;
  /** Everything the run drew, with its colour and cursor codes taken off. */
  plain(): string;
  /** Everything the run wrote to stderr, as written. */
  errors(): string;
}

/**
 * Puts the test's run at a terminal for the rest of the test: stdin is a stream
 * that reports `isTTY` and takes keys, stdout reports `isTTY` and is as wide as
 * any line needs, and everything written to stdout is kept for the test to
 * read. Nothing is replaced but the process's own streams, and each is given
 * back when the test ends.
 *
 * @param watch - Told of each thing drawn, as it is drawn.
 * @returns The keyboard and the screen.
 */
export function atTerminal(watch: (text: string) => void = () => undefined): Terminal {
  const shown: string[] = [];
  const failed: string[] = [];
  const raw: boolean[] = [];

  const keyboard = new PassThrough();
  Object.assign(keyboard, {
    isTTY: true,
    setRawMode: (mode: boolean) => {
      raw.push(mode);
      return keyboard;
    },
  });

  const stdout = process.stdout;
  const write = stdout.write;
  stdout.write = ((chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    shown.push(text);
    watch(text);
    const done = rest.find((candidate) => {
      return typeof candidate === "function";
    });
    if (typeof done === "function") {
      done();
    }
    return true;
  }) as typeof process.stdout.write;
  const stderr = process.stderr;
  const writeErrors = stderr.write;
  stderr.write = ((chunk: string | Uint8Array): boolean => {
    failed.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stderr.write;
  const columns = Object.getOwnPropertyDescriptor(stdout, "columns");
  const isTTY = Object.getOwnPropertyDescriptor(stdout, "isTTY");
  Object.defineProperty(stdout, "columns", { value: COLUMNS, configurable: true });
  Object.defineProperty(stdout, "isTTY", { value: true, configurable: true });
  const stdin = Object.getOwnPropertyDescriptor(process, "stdin");
  Object.defineProperty(process, "stdin", { value: keyboard, configurable: true });
  syncBuiltinESMExports();

  onTestFinished(() => {
    stdout.write = write;
    stderr.write = writeErrors;
    for (const [name, found] of [
      ["columns", columns],
      ["isTTY", isTTY],
    ] as const) {
      if (found === undefined) {
        Reflect.deleteProperty(stdout, name);
      } else {
        Object.defineProperty(stdout, name, found);
      }
    }
    if (stdin !== undefined) {
      Object.defineProperty(process, "stdin", stdin);
      syncBuiltinESMExports();
    }
  });

  return {
    keyboard,
    rawModes: () => {
      return raw;
    },
    shown: () => {
      return shown.join("");
    },
    plain: () => {
      return stripVTControlCharacters(shown.join(""));
    },
    errors: () => {
      return failed.join("");
    },
  };
}

/** What a person at the keyboard saw and was asked, for the test to read. */
export interface Person extends Terminal {
  /** Every question put to them, in order, as it was worded on screen. */
  asked(): string[];
  /** Every question's choices, in order, as they were worded on screen. */
  options(): string[][];
}

/**
 * Puts a person at the keyboard of the test's terminal ({@link atTerminal}) for
 * the rest of the test: the real prompts are drawn on it and answered by
 * pressing the keys a person would, one answer to each prompt in the order they
 * are asked. A prompt asked after the answers run out is walked away from.
 *
 * @param answers - What the person answers, one to each prompt: a string types or picks, a
 *   boolean answers a yes or no, a list ticks choices.
 * @returns What they were asked and saw, as the test asks for it.
 */
export function answering(...answers: ReadonlyArray<Answer | undefined>): Person {
  const queue = [...answers];
  const seen: Seen[] = [];
  const closings: boolean[] = [];
  // biome-ignore lint/plugin: the fake keyboard's state across newListener ticks
  let frame = "";
  // biome-ignore lint/plugin: the fake keyboard's state across newListener ticks
  let waiting = false;
  const terminal = atTerminal((text) => {
    frame += text;
    closings.push(text.includes(SHOW_CURSOR));
  });

  /**
   * Presses the keys for the next answer. A prompt that refuses what was typed
   * stays open and says why, so when the keys have been taken and it has not
   * closed, the person tries the next answer on it.
   */
  const press = (drawn: Drawn): void => {
    const before = closings.length;
    terminal.keyboard.write(keysFor(drawn, queue.shift()));
    setImmediate(() => {
      if (!closings.slice(before).includes(true)) {
        press(drawn);
      }
    });
  };

  terminal.keyboard.on("newListener", (event) => {
    if (event !== "keypress" || waiting) {
      return;
    }
    waiting = true;
    queueMicrotask(() => {
      waiting = false;
      const drawn = read(frame.slice(Math.max(frame.lastIndexOf(HIDE_CURSOR), 0)));
      frame = "";
      if (drawn.question === "") {
        return;
      }
      seen.push({ question: drawn.question, choices: drawn.choices });
      press(drawn);
    });
  });

  return {
    ...terminal,
    asked: () => {
      return seen.map((entry) => {
        return entry.question;
      });
    },
    options: () => {
      return seen.map((entry) => {
        return entry.choices;
      });
    },
  };
}

import { ListDeploymentsResponse } from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import { expect } from "vitest";
import { z } from "zod";

import { EXIT_CODE_FOR, type ErrorCode } from "./errors";
import { parseJson, stripAnsi } from "./run-cli";
import { asOneLine } from "./terminal";

/**
 * Whether a run said `text`, wherever the layout happened to break it.
 *
 * An ending is laid out for a terminal 80 columns wide, so a sentence folds
 * where its own length puts the fold and a step's command sits on a line
 * under the sentence that introduces it. A spec asserts the words a command
 * said; where they were broken is the layout's, and its unit tests'.
 *
 * Text that names a tab is matched exactly instead. A tab is not spacing in
 * what a normal command prints — it is the separator `cut` and `awk` read the
 * rows by — and flattening it would let a row that lost its tabs pass.
 */
const flows = (output: string, text: string): boolean =>
  output.includes(text) || (!text.includes("\t") && asOneLine(output).includes(asOneLine(text)));

/** Matchers that assert the CLI's behaviour in its own terms. */

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * A field of an envelope these matchers read, or nothing when it is absent or
 * of another kind, so one odd field leaves the rest of the envelope readable.
 *
 * @param schema - What the field holds when it is there.
 * @returns The field's schema, reading anything else as absent.
 */
function field<T extends z.ZodType>(schema: T) {
  return schema.optional().catch(undefined);
}

/** The commands an envelope suggests running next. */
const NextCommands = field(z.array(z.string()));

/**
 * The parts of a `--json` envelope these matchers read. Anything else it
 * carries is kept but not looked at.
 */
const EnvelopeSchema = z.looseObject({
  status: field(z.string()),
  code: field(z.string()),
  message: field(z.string()),
  hint: field(z.string()),
  command: field(z.string()),
  next_commands: NextCommands,
  data: field(
    z.looseObject({
      next_commands: NextCommands,
    }),
  ),
});

/** A `--json` envelope, as far as these matchers read it. */
type Envelope = Readonly<z.infer<typeof EnvelopeSchema>>;

/**
 * The deployment record as the contract declares it, read from the generated
 * schema rather than written out again: a field the API gains is a field a
 * command must answer, and a list copied by hand would instead fail on it.
 * The optional ones are the contract's own (`release`, there only when a read
 * expanded it), so they are not required either.
 */
const DEPLOYMENT_RECORD = Object.entries(
  ListDeploymentsResponse.shape.deployments.element.shape,
).map(([field, schema]) => {
  return {
    field,
    // The schema's own kind, not whether it accepts `undefined`: a field the
    // contract gives a default accepts it too, and a command still has to
    // answer that one.
    optional: schema.def.type === "optional",
  };
});

/** The fields the contract requires of a deployment record. */
const DEPLOYMENT_RECORD_KEYS: readonly string[] = DEPLOYMENT_RECORD.filter((entry) => {
  return !entry.optional;
}).map((entry) => {
  return entry.field;
});

/** The fields it allows but does not require, such as an expanded `release`. */
const DEPLOYMENT_RECORD_OPTIONAL: readonly string[] = DEPLOYMENT_RECORD.filter((entry) => {
  return entry.optional;
}).map((entry) => {
  return entry.field;
});

/** Whether a value read out of an envelope is an object with fields to count. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An error envelope carries these at the root; a successful one under `data`. */
function suggestionsIn(envelope: Envelope): string[] {
  return envelope.next_commands ?? envelope.data?.next_commands ?? [];
}

/**
 * The envelope a run printed, or an empty one when stdout is not a JSON
 * object.
 *
 * @param result - The finished run.
 * @returns What the matchers read of its envelope.
 */
function envelopeOf(result: CliResult): Envelope {
  try {
    const parsed = EnvelopeSchema.safeParse(parseJson(result.stdout));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * The commands a run suggested, each without the runner that spells it out
 * (`npx @zitadel/cli@<version>`), which differs by how the CLI was invoked.
 *
 * @param received - The finished run.
 * @returns The suggested commands, in the order they were suggested.
 */
function commandsAfterRunner(received: CliResult): string[] {
  return suggestionsIn(envelopeOf(received)).map((candidate) => {
    return candidate.replace(/^.*?(?:@zitadel\/cli(?:@\S+)?|zitadel) /, "");
  });
}

function describeResult(result: CliResult): string {
  const envelope = envelopeOf(result);
  const name = envelope.command ? `\`${envelope.command}\`` : "the command";
  const parts = [`exit ${result.exitCode}`];
  if (envelope.status) parts.push(`status "${envelope.status}"`);
  if (envelope.code) parts.push(`code "${envelope.code}"`);
  const output = result.stdout.trim() || result.stderr.trim();
  return `${name} returned ${parts.join(", ")}${output ? `\n\n${output.slice(0, 600)}` : ""}`;
}

/**
 * What a run printed, as its content rather than as its presentation: the
 * colour the CLI paints is stripped, so one assertion holds whether the run was
 * coloured or not. A test that is about the colour itself reads
 * `result.stdout` directly.
 */
const shown = (received: CliResult): string => stripAnsi(received.stdout);

/** What a run said on either stream, likewise as content. */
const said = (received: CliResult): string =>
  `${stripAnsi(received.stdout)}\n${stripAnsi(received.stderr)}`;

/** One cell of a tab-separated row: its exact text, or a pattern for a value that varies. */
type Cell = string | RegExp;

const plainRowsOf = (received: CliResult): string[][] => {
  if (shown(received) === "") {
    return [];
  }
  return shown(received)
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => line.split("\t"));
};

const sameCell = (found: string | undefined, cell: Cell): boolean => {
  if (typeof cell === "string") {
    return found === cell;
  }
  return new RegExp(cell.source, cell.flags.replace("g", "")).test(found ?? "");
};

const sameRow = (row: string[] | undefined, cells: Cell[]): boolean => {
  if (row === undefined || row.length !== cells.length) {
    return false;
  }
  return cells.every((cell, at) => {
    return sameCell(row[at], cell);
  });
};

expect.extend({
  toSucceed(received: CliResult) {
    const envelope = envelopeOf(received);
    const pass = received.exitCode === 0 && envelope.status !== "error";
    return {
      pass,
      message: () =>
        pass
          ? `expected the command to fail, but ${describeResult(received)}`
          : `expected the command to succeed, but ${describeResult(received)}`,
    };
  },

  toBeSkipped(received: CliResult) {
    const envelope = envelopeOf(received);
    const pass = received.exitCode === 0 && envelope.status === "skipped";
    return {
      pass,
      message: () =>
        pass
          ? `expected the command not to report "skipped", but it did`
          : `expected the command to report "skipped", but ${describeResult(received)}`,
    };
  },

  toExitWith(received: CliResult, code: number) {
    const pass = received.exitCode === code;
    return {
      pass,
      message: () =>
        pass
          ? `expected the command not to exit ${code}, but it did`
          : `expected the command to exit ${code}, but ${describeResult(received)}`,
    };
  },

  toFail(received: CliResult) {
    const pass = received.exitCode !== 0;
    return {
      pass,
      message: () =>
        pass
          ? `expected the command to succeed, but it failed`
          : `expected the command to fail, but ${describeResult(received)}`,
    };
  },

  toFailWith(received: CliResult, code: ErrorCode) {
    const envelope = envelopeOf(received);
    const expectedExit = EXIT_CODE_FOR[code];
    const named = envelope.status === "error" && envelope.code === code;
    const pass = named && received.exitCode === expectedExit;
    return {
      pass,
      message: () =>
        pass
          ? `expected the command not to fail with ${code}, but it did`
          : named
            ? `expected ${code} to exit ${expectedExit}, but ${describeResult(received)}`
            : `expected the command to fail with ${code}, but ${describeResult(received)}`,
    };
  },

  toCarryTheDeploymentRecord(received: unknown) {
    const keys = isObject(received) ? Object.keys(received).sort() : [];
    const missing = DEPLOYMENT_RECORD_KEYS.filter((key) => {
      return !keys.includes(key);
    });
    const extra = keys.filter((key) => {
      return !DEPLOYMENT_RECORD_KEYS.includes(key) && !DEPLOYMENT_RECORD_OPTIONAL.includes(key);
    });
    const pass = missing.length === 0 && extra.length === 0;
    return {
      pass,
      message: () =>
        pass
          ? "expected the item not to carry the deployment record, but it did"
          : `expected the item to carry the deployment record${
              missing.length > 0 ? `, but it was missing ${missing.join(", ")}` : ""
            }${extra.length > 0 ? `, but it also carried ${extra.join(", ")}` : ""} (it had ${
              keys.join(", ") || "no fields"
            })`,
    };
  },

  toExplain(received: CliResult, text: string) {
    const message = envelopeOf(received).message ?? "";
    const pass = message.includes(text);
    return {
      pass,
      message: () =>
        pass
          ? `expected the message not to mention "${text}", but it was: ${message}`
          : `expected the message to mention "${text}", but it was: ${message || "(none)"}`,
    };
  },

  toExplainExactly(received: CliResult, text: string) {
    const message = envelopeOf(received).message ?? "";
    const pass = message === text;
    return {
      pass,
      message: () =>
        pass
          ? `expected the message not to be exactly "${text}", but it was`
          : `expected the message to be exactly "${text}", but it was: ${message || "(none)"}`,
    };
  },

  toHintAt(received: CliResult, text: string) {
    const hint = envelopeOf(received).hint ?? "";
    const pass = hint.includes(text);
    return {
      pass,
      message: () =>
        pass
          ? `expected the hint not to mention "${text}", but it was: ${hint}`
          : `expected the hint to mention "${text}", but it was: ${hint || "(none)"}`,
    };
  },

  toSuggest(received: CliResult, command: string) {
    const suggested = suggestionsIn(envelopeOf(received));
    const pass = suggested.some((candidate) => candidate.includes(command));
    return {
      pass,
      message: () =>
        pass
          ? `expected not to suggest "${command}", but next_commands were: ${suggested.join(", ")}`
          : `expected to suggest "${command}", but next_commands were: ${
              suggested.join(", ") || "(none)"
            }`,
    };
  },

  toSuggestExactly(received: CliResult, command: string) {
    const suggested = commandsAfterRunner(received);
    const pass = suggested.includes(command);
    return {
      pass,
      message: () =>
        pass
          ? `expected not to suggest exactly "${command}", but it did`
          : `expected to suggest exactly "${command}", but next_commands were: ${
              suggested.join(", ") || "(none)"
            }`,
    };
  },

  toSuggestOnly(received: CliResult, ...commands: string[]) {
    const suggested = commandsAfterRunner(received);
    const pass =
      suggested.length === commands.length &&
      suggested.every((command, index) => {
        return command === commands[index];
      });
    return {
      pass,
      message: () =>
        pass
          ? `expected the suggestions not to be exactly: ${commands.join(", ")}`
          : `expected the suggestions to be exactly: ${commands.join(", ") || "(none)"}, but next_commands were: ${
              suggested.join(", ") || "(none)"
            }`,
    };
  },

  toPrint(received: CliResult, text: string) {
    const pass = flows(shown(received), text);
    return {
      pass,
      message: () =>
        pass
          ? `expected stdout not to contain "${text}", but it did`
          : `expected stdout to contain "${text}", but stdout was:\n\n${
              shown(received).trim().slice(0, 600) || "(empty)"
            }`,
    };
  },

  toPrintExactly(received: CliResult, text: string) {
    const pass = shown(received).includes(text);
    return {
      pass,
      message: () =>
        pass
          ? `expected stdout not to contain exactly ${JSON.stringify(text)}, but it did`
          : `expected stdout to contain exactly ${JSON.stringify(text)}, but stdout was:\n\n${
              shown(received).trim().slice(0, 600) || "(empty)"
            }`,
    };
  },

  toPrintRow(received: CliResult, ...cells: string[]) {
    const row = new RegExp(
      cells.map((cell) => cell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"),
    );
    const pass = shown(received)
      .split("\n")
      .some((line) => row.test(line));
    return {
      pass,
      message: () =>
        pass
          ? `expected stdout not to have a row with ${cells.map((cell) => `"${cell}"`).join(", ")}, but it did`
          : `expected stdout to have a row with ${cells.map((cell) => `"${cell}"`).join(", ")} in order, but stdout was:\n\n${
              shown(received).trim().slice(0, 600) || "(empty)"
            }`,
    };
  },

  toPrintPlainRows(received: CliResult, ...rows: Cell[][]) {
    const printed = plainRowsOf(received);
    const pass =
      printed.length === rows.length &&
      rows.every((row, at) => {
        return sameRow(printed[at], row);
      });
    return {
      pass,
      message: () =>
        pass
          ? `expected stdout not to be exactly these tab-separated rows, but it was`
          : `expected stdout to be exactly ${rows.length} tab-separated rows, with no header, matching:\n\n${
              rows.map((row) => row.map(String).join("\t")).join("\n") || "(none)"
            }\n\nbut stdout was:\n\n${shown(received).slice(0, 600) || "(empty)"}`,
    };
  },

  toPrintPlainRow(received: CliResult, ...cells: Cell[]) {
    const pass = plainRowsOf(received).some((row) => sameRow(row, cells));
    return {
      pass,
      message: () =>
        pass
          ? `expected stdout not to have a tab-separated row of ${cells.map(String).join(", ")}, but it did`
          : `expected stdout to have a tab-separated row of ${cells.map(String).join(", ")}, but stdout was:\n\n${
              shown(received).slice(0, 600) || "(empty)"
            }`,
    };
  },

  toPrintNoJson(received: CliResult) {
    const printed = shown(received).trim();
    const pass = printed.length > 0 && !printed.startsWith("{");
    return {
      pass,
      message: () =>
        pass
          ? `expected stdout to be a JSON envelope, but it was not`
          : `expected stdout to carry rendered text rather than JSON, but it was:\n\n${
              printed.slice(0, 300) || "(empty)"
            }`,
    };
  },

  toSayOnce(received: CliResult, text: string) {
    const count = asOneLine(said(received)).split(asOneLine(text)).length - 1;
    return {
      pass: count === 1,
      message: () =>
        `expected the output to say "${text}" exactly once, but it said it ${count} times:\n\n${said(received).trim().slice(0, 600)}`,
    };
  },

  toSay(received: CliResult, text: string) {
    const output = said(received);
    const pass = flows(output, text);
    return {
      pass,
      message: () =>
        pass
          ? `expected the output not to say "${text}", but it did`
          : `expected the output to say "${text}", but it was:\n\n${output.trim().slice(0, 600)}`,
    };
  },
});

declare module "vitest" {
  /**
   * The CLI's own matchers, merged into vitest's. The type parameter's default
   * is vitest's to declare, so it is left off here.
   */
  interface Matchers<T> {
    /** Exit 0 and an envelope that is not an error. */
    toSucceed(): T;
    /** Exit 0 and `status: "skipped"` — the command found nothing to do. */
    toBeSkipped(): T;
    /** A non-zero exit, whatever the reason. */
    toFail(): T;
    /** This exact exit code, for a code that is itself the contract. */
    toExitWith(code: number): T;
    /**
     * An error envelope carrying this code, exiting with the number
     * `EXIT_CODE_FOR` says it maps to.
     */
    toFailWith(code: ErrorCode): T;
    /**
     * This item carries every field the API answers a deployment with — the
     * entity it came from names fewer of them, so a command that emits the
     * entity rather than the record is caught here.
     */
    toCarryTheDeploymentRecord(): T;
    /** The envelope's `message` mentions this text. */
    toExplain(text: string): T;
    /** The envelope's `message` is exactly this text: no full stop or other wording added. */
    toExplainExactly(text: string): T;
    /** The envelope's `hint` mentions this text. */
    toHintAt(text: string): T;
    /** One of the suggested `next_commands` contains this text. */
    toSuggest(command: string): T;
    /**
     * One of the suggested `next_commands` is exactly this, after the runner
     * (`npx @zitadel/cli@<version>`): no flag missing, extra or repeated.
     */
    toSuggestExactly(command: string): T;
    /**
     * The suggested `next_commands` are exactly these, in this order, after the
     * runner (`npx @zitadel/cli@<version>`): none missing and none extra.
     */
    toSuggestOnly(...commands: string[]): T;
    /** stdout contains this text. Prefer it over `toSay` for rendered output. */
    toPrint(text: string): T;
    /** stdout contains this text byte for byte, line breaks included, where `toPrint` lets them fold. */
    toPrintExactly(text: string): T;
    /** One line of stdout holds these cells in this order, whatever the spacing between them. */
    toPrintRow(...cells: string[]): T;
    /** stdout is exactly these records, one per line, cells separated by tabs, with no header. */
    toPrintPlainRows(...rows: Cell[][]): T;
    /** One line of stdout is these cells separated by tabs, for a list too long to give whole. */
    toPrintPlainRow(...cells: Cell[]): T;
    /** stdout carries rendered text, and is neither empty nor a JSON envelope. */
    toPrintNoJson(): T;
    /** The output, stdout or stderr, contains this text, and only once. */
    toSayOnce(text: string): T;
    /** The output, stdout or stderr, contains this text. */
    toSay(text: string): T;
  }
}

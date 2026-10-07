import { expect } from "vitest";

import { EXIT_CODE_FOR, type ErrorCode } from "./errors";
import { parseJson } from "./run-cli";

/** Matchers that assert the CLI's behaviour in its own terms. */

interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface Envelope {
  status?: string;
  code?: string;
  message?: string;
  hint?: string;
  command?: string;
  next_commands?: string[];
  data?: { next_commands?: string[] };
}

/** An error envelope carries these at the root; a successful one under `data`. */
function suggestionsIn(envelope: Envelope): string[] {
  return envelope.next_commands ?? envelope.data?.next_commands ?? [];
}

interface PlanTotals {
  creates: number;
  updates: number;
  deletes: number;
  total: number;
}

function envelopeOf(result: CliResult): Envelope {
  try {
    return parseJson(result.stdout) as Envelope;
  } catch {
    return {};
  }
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

  toPrint(received: CliResult, text: string) {
    const pass = received.stdout.includes(text);
    return {
      pass,
      message: () =>
        pass
          ? `expected stdout not to contain "${text}", but it did`
          : `expected stdout to contain "${text}", but stdout was:\n\n${
              received.stdout.trim().slice(0, 600) || "(empty)"
            }`,
    };
  },

  toPrintNoJson(received: CliResult) {
    const printed = received.stdout.trim();
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

  toSay(received: CliResult, text: string) {
    const output = `${received.stdout}\n${received.stderr}`;
    const pass = output.includes(text);
    return {
      pass,
      message: () =>
        pass
          ? `expected the output not to say "${text}", but it did`
          : `expected the output to say "${text}", but it was:\n\n${output.trim().slice(0, 600)}`,
    };
  },

  toReportNothingToDo(received: PlanTotals) {
    const pending = received.creates + received.updates + received.deletes;
    const pass = pending === 0 && received.total === 0;
    return {
      pass,
      message: () =>
        pass
          ? `expected something left to reconcile, but the plan was empty`
          : `expected nothing left to reconcile, but the plan has ${received.creates} creates, ${received.updates} updates, ${received.deletes} deletes (total ${received.total})`,
    };
  },
});

declare module "vitest" {
  interface Matchers<T = any> {
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
    /** The envelope's `message` mentions this text. */
    toExplain(text: string): T;
    /** The envelope's `hint` mentions this text. */
    toHintAt(text: string): T;
    /** One of the suggested `next_commands` contains this text. */
    toSuggest(command: string): T;
    /** stdout contains this text. Prefer it over `toSay` for rendered output. */
    toPrint(text: string): T;
    /** stdout carries rendered text, and is neither empty nor a JSON envelope. */
    toPrintNoJson(): T;
    /** The output, stdout or stderr, contains this text. */
    toSay(text: string): T;
    /** Plan totals that are all zero. */
    toReportNothingToDo(): T;
  }
}

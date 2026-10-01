import { cancel, isCancel } from "@clack/prompts";

import { ZitadelError } from "./errors";

/**
 * Converts a clack cancellation (Ctrl-C) into a thrown `E_VALIDATION` rather
 * than a partial answer, so a command never proceeds with a sentinel or a
 * missing value.
 *
 * `command` names what was cancelled, because the wording reaches the
 * developer twice: once as clack's own closing line and once as the error a
 * scripted caller reads.
 */
export function bailOnCancel<T>(value: T | symbol, command: string): asserts value is T {
  if (isCancel(value)) {
    cancel(`${command} cancelled.`);
    throw new ZitadelError("E_VALIDATION", `${command} cancelled by user`);
  }
}

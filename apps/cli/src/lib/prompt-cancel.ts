import { cancel, isCancel, password, text } from "@clack/prompts";

import type { Parsed } from "@zitadel/config/idp";

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

/**
 * One question whose answer must parse. The prompt shows what is wrong with an
 * answer as it is typed and does not accept one that does not parse, so what
 * comes back is the parsed value and not text to check again. A cancellation
 * is reported as `command` was cancelled.
 *
 * `secret` masks the input, for a credential.
 */
export async function askParsed<T>(options: {
  readonly message: string;
  readonly parse: (value: string) => Parsed<T>;
  readonly command: string;
  readonly secret?: boolean;
  readonly initialValue?: string;
}): Promise<T> {
  const { message, parse, command } = options;
  const validate = (value: string | undefined) => {
    const parsed = parse(value ?? "");
    return parsed.ok ? undefined : parsed.problem;
  };
  const answer = options.secret
    ? await password({ message, validate })
    : await text({ message, validate, initialValue: options.initialValue });
  bailOnCancel(answer, command);
  const parsed = parse(String(answer));
  if (!parsed.ok) {
    throw new Error(`an answer the prompt accepted does not parse: ${parsed.problem}`);
  }
  return parsed.value;
}

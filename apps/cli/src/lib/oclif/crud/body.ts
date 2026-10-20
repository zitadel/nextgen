import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";

import { ZitadelError } from "../../errors";
import { parseJsonObject } from "../../json";
import type { Json } from "./types";

/**
 * The raw body of a write, from `--data` (inline), `--file <path>`, or
 * `--file -` (stdin). Returns `undefined` when none of them was given: the
 * caller decides whether that is an error, since a body can also be assembled
 * from the field flags and `--set`. `what` names the command in the stdin
 * hint.
 *
 * Nothing here judges the content: `--data` is on the command line like any
 * flag, so the write command checks it for credentials together with the
 * field flags and `--set`, against the schema that says what each value is.
 */
export const readRawBody = async (flags: Json, what: string): Promise<Json | undefined> => {
  if (typeof flags.data === "string") {
    return parseJsonObject(flags.data, "--data");
  }
  if (flags.file === "-") {
    // Reading stdin to end-of-file when stdin is the keyboard looks like a
    // hang: no output, no error, nothing to do but Ctrl-C. The CLI guidelines
    // say to notice and say so instead.
    if (process.stdin.isTTY) {
      throw new ZitadelError(
        "E_VALIDATION",
        "--file - reads the body from a pipe, but nothing is piped in",
        {
          hint: `Pipe a body in (\`cat body.json | zitadel ${what}\`), or pass it with --file <path> or --data '<json>'.`,
        },
      );
    }
    return parseJsonObject(await text(process.stdin), "stdin");
  }
  if (typeof flags.file === "string") {
    return parseJsonObject(await readFile(flags.file, "utf8"), flags.file);
  }
  return undefined;
};

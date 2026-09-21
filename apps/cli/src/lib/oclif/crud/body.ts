import { readFile } from "node:fs/promises";
import { text } from "node:stream/consumers";

import { ZitadelError } from "../../errors";
import { findSecretKey, refuseSecret } from "./secrets";
import { parseJsonObject } from "../../json";
import type { Json } from "./types";

/**
 * The raw body of a write, from `--data` (inline), `--file <path>`, or
 * `--file -` (stdin). Returns `undefined` when none of them was given: the
 * caller decides whether that is an error, since a body can also be assembled
 * from the field flags. `what` names the command in the stdin hint.
 */
export const readRawBody = async (flags: Json, what: string): Promise<Json | undefined> => {
  if (typeof flags.data === "string") {
    const body = parseJsonObject(flags.data, "--data");
    // `--data` is a flag value like any other, and `--data "$(cat body.json)"`
    // is expanded by the shell before the CLI sees it, so a credential here is
    // just as exposed as one in `--attributes`.
    const secret = findSecretKey(body);
    if (secret) {
      refuseSecret(secret, "--data");
    }
    return body;
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

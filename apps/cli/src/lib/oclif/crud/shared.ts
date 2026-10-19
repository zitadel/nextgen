import { nonBlankArg } from "../flags";

import { ZitadelError } from "../../errors";
import type { CommandResult } from "../types";
import { redactSecrets } from "./secrets";
import type { Json, ResourceDescriptor, Schema } from "./types";

/** Helpers shared by more than one verb builder. */

/** The name of a resource's positional argument. */
export const idName = <Ctx>(resource: ResourceDescriptor<Ctx>): string => resource.idArg ?? "id";

/** The single positional argument the id-taking verbs share. */
export const idArg = <Ctx>(resource: ResourceDescriptor<Ctx>) => {
  const name = idName(resource);
  const description = resource.idDescription ?? `${resource.singular} ${name}`;
  return { [name]: nonBlankArg({ required: true, description }) };
};

/** The value the caller passed for that argument. */
export const idValue = <Ctx>(resource: ResourceDescriptor<Ctx>, args: Json): string =>
  String(args[idName(resource)]);

/**
 * Words spelled with a vowel but said with a "yoo" sound, so they take "a":
 * "a user", "a unique id". Add one here when a resource noun needs it.
 */
const YOO_SOUND = /^(?:user|unique|unit|usage)/i;

/**
 * The indefinite article for a noun phrase, so a generated description reads
 * as English: "an identity provider connection", not "a identity provider
 * connection". A vowel letter takes "an", except a word in {@link YOO_SOUND}.
 * A silent "h" ("an hour") is not handled; no resource noun starts with one.
 */
export const article = (phrase: string): string =>
  /^[aeiou]/i.test(phrase) && !YOO_SOUND.test(phrase) ? "an" : "a";

export const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Validate with a generated schema, translating a failure into the CLI's
 * `E_VALIDATION` envelope with the issues attached — the same shape
 * `toZitadelError` produces for a thrown Zod error, with a message and hint
 * that name the flag the user got wrong.
 */
export const parseOrThrow = <B>(
  schema: Schema<B>,
  value: unknown,
  message: string,
  hint?: string,
): B => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ZitadelError("E_VALIDATION", message, {
      hint,
      details: { issues: parsed.error.issues },
    });
  }
  return parsed.data;
};

export const dryRunResult = (
  verb: string,
  topic: string,
  id?: string,
  body?: Json,
): CommandResult => {
  // A body that came from a file may legitimately hold a credential; a preview
  // of it must not put that value on screen or into a CI log.
  const shown = body === undefined ? undefined : (redactSecrets(body) as Json);
  return {
    status: "ok",
    data: { dry_run: true, verb, topic, id, body: shown },
    pretty: `Dry run: would ${verb} ${[topic, id].filter(Boolean).join(" ")}${shown ? `\n${JSON.stringify(shown, null, 2)}` : ""}`,
  };
};

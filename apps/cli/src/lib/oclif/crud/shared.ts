import { nonBlankArg } from "../flags";
import { named } from "../names";

import { ZitadelError } from "../../errors";
import type { CommandResult } from "../types";
import { type CredentialContext, redactCredentials } from "./secrets";
import type { Json, ResourceDescriptor, Schema } from "./types";
import { prose } from "../rendering";

/** Helpers shared by more than one verb builder. */

/** The name of a resource's positional argument. */
export const idName = <Ctx>(resource: ResourceDescriptor<Ctx>): string => resource.idArg ?? "id";

/** The single positional argument the id-taking verbs share. */
export const idArg = <Ctx>(resource: ResourceDescriptor<Ctx>) => {
  const name = idName(resource);
  const description = resource.idDescription ?? `${resource.singular} ${name}`;
  return { [name]: nonBlankArg({ required: true, description }) };
};

/** The value the caller passed for that argument, read as a command reads it. */
export const idValue = <Ctx>(resource: ResourceDescriptor<Ctx>, args: Json): string =>
  String(args[named(idName(resource))]);

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

/**
 * What a command says it would do, for {@link dryRunResult}. `clause` ends the
 * subject line, so a command that says where the change lands says it here
 * rather than splicing the rendering it was handed.
 */
export type DryRun = Readonly<{
  verb: string;
  topic: string;
  id?: string;
  /** What the subject line ends with: "from the project", "on the project (secret)". */
  clause?: string;
  body?: Json;
  context?: CredentialContext;
}>;

export const dryRunResult = ({ verb, topic, id, clause, body, context }: DryRun): CommandResult => {
  // A body that came from a file may legitimately hold a credential; a preview
  // of it must not put that value on screen or into a CI log. Only the
  // credentials are masked: the rest is what would be sent, so the preview can
  // be checked, and saved as a document to send later (ADR 071 §8).
  const shown = body === undefined ? undefined : (redactCredentials(body, context) as Json);
  const subject = [topic, id, clause].filter(Boolean).join(" ");
  const printed = shown === undefined ? "" : `\n${JSON.stringify(shown, null, 2)}`;
  return {
    status: "ok",
    data: { dry_run: true, verb, topic, id, body: shown },
    pretty: prose(`Dry run: would ${verb} ${subject}${printed}`),
  };
};

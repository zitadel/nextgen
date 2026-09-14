import { Args } from "@oclif/core";

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
  return { [name]: Args.string({ required: true, description: `${resource.singular} ${name}` }) };
};

/** The value the caller passed for that argument. */
export const idValue = <Ctx>(resource: ResourceDescriptor<Ctx>, args: Json): string =>
  String(args[idName(resource)]);

export const capitalize = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/**
 * Validate with a generated schema, translating a failure into the CLI's
 * `E_VALIDATION` envelope with the issues attached — the same shape
 * `toZitadelError` produces for a thrown Zod error, with a message and hint
 * that name the flag the user got wrong.
 */
export const parseOrThrow = (
  schema: Schema,
  value: unknown,
  message: string,
  hint?: string,
): Json => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ZitadelError("E_VALIDATION", message, {
      hint,
      details: { issues: parsed.error?.issues },
    });
  }
  return parsed.data as Json;
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

import type { Parsed } from "@zitadel/config/idp";
import { POLICY_FILE_SCHEMA_REF } from "@zitadel/config/meta-schemas";
import { policyConfigSchema, RECOMMENDED_PASSWORD_MIN_LENGTH } from "@zitadel/config/schemas";

import { Policy } from "@/lib/zitadel/resources/policies/policy";
import {
  PASSWORD_POLICY_OPERATION,
  type PasswordMinLength,
} from "@/lib/zitadel/resources/policies/types";
import { CONFIG_DIRECTORIES } from "@/lib/zitadel/types";

/**
 * Where the password policy lives, relative to the project root.
 *
 * @remarks
 * Here rather than in `types.ts`, which imports no value, because the name
 * comes from {@link Policy.fileName}.
 */
export const PASSWORD_POLICY_PATH = `${CONFIG_DIRECTORIES.policies}/${Policy.fileName(PASSWORD_POLICY_OPERATION)}`;

/**
 * The bounds the policy contract sets on a minimum password length, from the
 * generated publish body, so the CLI and the server cannot disagree on them.
 */
const MIN_LENGTH = policyConfigSchema.shape.config.shape.min_length.unwrap();

/**
 * The password policy `setup` writes for a new project.
 *
 * @param minLength - The minimum setup was given: a length, `null` for an
 *   explicit "none", or `undefined` when none was given.
 * @returns A new policy with the given minimum,
 *   {@link RECOMMENDED_PASSWORD_MIN_LENGTH} when none was given, and an empty
 *   `config`, which enforces nothing, for "none".
 */
export function passwordPolicy(minLength?: PasswordMinLength): Policy {
  const value = minLength === undefined ? RECOMMENDED_PASSWORD_MIN_LENGTH : minLength;
  return Policy.create({
    path: PASSWORD_POLICY_PATH,
    body: {
      $schema: POLICY_FILE_SCHEMA_REF,
      operation: PASSWORD_POLICY_OPERATION,
      config: value === null ? {} : { min_length: value },
    },
  });
}

/**
 * Read a minimum password length the way `setup` takes one, from its flag or
 * its prompt.
 *
 * @remarks
 * A minimum of 0 enforces nothing, so it means none: the file keeps one form
 * for "off", the setting left out, which its bounds (1 and up) teach.
 *
 * @param value - The text given.
 * @returns `null` for an empty answer or 0, the length for a whole number the
 *   contract's bounds accept, and the problem for anything else.
 */
export function parsePasswordMinLength(value: string): Parsed<PasswordMinLength> {
  const text = value.trim();
  if (text === "" || /^0+$/.test(text)) {
    return { ok: true, value: null };
  }
  const result = MIN_LENGTH.safeParse(Number(text));
  if (!/^\d+$/.test(text) || !result.success) {
    return {
      ok: false,
      problem: `Must be a whole number from ${MIN_LENGTH.minValue} to ${MIN_LENGTH.maxValue}, or 0 for none`,
    };
  }
  return { ok: true, value: result.data };
}

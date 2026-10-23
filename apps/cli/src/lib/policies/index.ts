/**
 * Operation policies (ADR 066): one `.zitadel/policies/<operation>.json` file
 * per guarded operation, which `apply` publishes through `POST /policies` as
 * the operation's newest revision.
 *
 * **Source of truth.** The file is the publish body plus `$schema`; its shape
 * is `policy.json`, the meta-schema generated from the OpenAPI spec and
 * shipped by `@zitadel/config`, and the CLI checks it with
 * `policyConfigSchema` from the same generated contract. The server's template
 * checks it again on publish, together with the rules that relate settings to
 * each other.
 *
 * **Dependency rule.** No upward imports (`commands/`, `sync/`).
 */
import {
  PublishPolicyBody as PublishPolicyBodySchema,
  publishPolicyBodyOneConfigMinLengthMax,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import type { PublishPolicyBody } from "@zitadel/api/generated/model";
import type { Parsed } from "@zitadel/config/idp";
import { POLICY_FILE_SCHEMA_REF } from "@zitadel/config/meta-schemas";

/** Project-relative directory the policy files live in. */
export const POLICIES_DIR = ".zitadel/policies";

/** A policy file as `policyConfigSchema` accepts it. */
export type PolicyFile = {
  $schema?: string;
  operation: PublishPolicyBody["operation"];
  config: PublishPolicyBody["config"];
};

/**
 * The body `POST /policies` takes, and the form a stored policy compares in:
 * the file without its editor pointer.
 */
export function toPolicyWireBody(file: PolicyFile): PublishPolicyBody {
  return { operation: file.operation, config: file.config };
}

/** The name a policy file must have: its operation, so one file holds one operation's policy. */
export function policyFileName(operation: string): string {
  return `${operation}.json`;
}

/** The operation the password policy guards, and the name of its file. */
export const PASSWORD_POLICY_OPERATION = "auth.factor.password.set";

/** Where `setup` writes the password policy. */
export const PASSWORD_POLICY_PATH = `${POLICIES_DIR}/${policyFileName(PASSWORD_POLICY_OPERATION)}`;

/**
 * The password policy file `setup` writes. Without a minimum its `config` is
 * empty, which enforces nothing: the CLI does not choose a value on the
 * project's behalf, it only makes the policy easy to find and to set.
 */
export function passwordPolicyFile(minLength?: number): PolicyFile & { $schema: string } {
  return {
    $schema: POLICY_FILE_SCHEMA_REF,
    operation: PASSWORD_POLICY_OPERATION,
    config: minLength === undefined ? {} : { min_length: minLength },
  };
}

/**
 * Reads a minimum password length the way `setup` takes one, from its flag or
 * its prompt: empty means none, anything else a whole number the template's
 * bounds accept. The bounds come from the generated publish body, so the CLI
 * and the server cannot disagree on them.
 */
export function parsePasswordMinLength(value: string): Parsed<number | undefined> {
  const text = value.trim();
  // A minimum of 0 enforces nothing, so it means none: the file keeps one
  // form for "off", the setting left out, which its bounds (1 and up) teach.
  if (text === "" || /^0+$/.test(text)) {
    return { ok: true, value: undefined };
  }
  const result = PublishPolicyBodySchema.shape.config.shape.min_length.safeParse(Number(text));
  if (!/^\d+$/.test(text) || !result.success || result.data === undefined) {
    return {
      ok: false,
      problem: `Must be a whole number from 1 to ${publishPolicyBodyOneConfigMinLengthMax}, or 0 for none`,
    };
  }
  return { ok: true, value: result.data };
}

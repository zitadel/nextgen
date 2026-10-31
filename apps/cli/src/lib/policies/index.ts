/**
 * Operation policies (ADR 066): one `.zitadel/policies/<operation>.json` file
 * per guarded operation, which `deploy` carries in the release bundle. The
 * server publishes each as the operation's newest revision when the config
 * changed, and the release pins it.
 *
 * **Source of truth.** The file is the publish body plus `$schema`; its shape
 * is `policy.json`, the meta-schema generated from the OpenAPI spec and
 * shipped by `@zitadel/config`, and the CLI checks it with
 * `policyConfigSchema` from the same generated contract. The server's template
 * checks it again on the build, together with the rules that relate settings
 * to each other.
 *
 * **Dependency rule.** No upward imports (`commands/`, `release/`).
 */
import {
  PublishPolicyBody as PublishPolicyBodySchema,
  publishPolicyBodyOneConfigMinLengthMax,
} from "@zitadel/api/generated/endpoints/zitadelNextGen.zod";
import type { PublishPolicyBody } from "@zitadel/api/generated/model";
import { policyConfigSchema, RECOMMENDED_PASSWORD_MIN_LENGTH } from "@zitadel/config/schemas";
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

/**
 * The suffix of a policy test file (`<operation>.test.json`), which sits
 * beside the policies but is never deployed: `zitadel policies test` runs it.
 */
export const POLICY_TEST_SUFFIX = ".test.json";

/** Whether a file in `.zitadel/policies/` is a test file rather than a policy. */
export function isPolicyTestFile(name: string): boolean {
  return name.endsWith(POLICY_TEST_SUFFIX);
}

/** The name a policy file must have: its operation, so one file holds one operation's policy. */
export function policyFileName(operation: string): string {
  return `${operation}.json`;
}

/**
 * What is wrong with a policy file, each as a line naming the file, or none.
 * The file must parse against the strict `policyConfigSchema`, built from the
 * generated publish body, and be named after its operation: one file per
 * operation, so two files can never carry the same policy. The rules that
 * relate settings to each other (a minimum above the maximum) are the server
 * template's, and fail the release build.
 */
export function policyFileIssues(data: unknown, file: string): string[] {
  const result = policyConfigSchema.safeParse(data);
  if (!result.success) {
    return result.error.issues.map(
      (issue) => `${file}: ${issue.path.join(".") || "(root)"} ${issue.message}`,
    );
  }
  const expected = policyFileName(result.data.operation);
  const name = file.split("/").at(-1);
  if (name !== expected) {
    return [`${file} holds the ${result.data.operation} policy, so it must be named ${expected}`];
  }
  return [];
}

/** The operation the password policy guards, and the name of its file. */
export const PASSWORD_POLICY_OPERATION = "auth.factor.password.set";

/** Where `setup` writes the password policy. */
export const PASSWORD_POLICY_PATH = `${POLICIES_DIR}/${policyFileName(PASSWORD_POLICY_OPERATION)}`;

/**
 * A minimum password length as `setup` was given it: a number, or `null` for
 * an explicit "none" (an empty answer, or 0), which is not the same as not
 * being asked: a new policy file gets {@link RECOMMENDED_PASSWORD_MIN_LENGTH}
 * when nothing was given, and a kept one loses its `min_length` on "none" and
 * keeps it when nothing was given.
 */
export type PasswordMinLength = number | null;

/**
 * The password policy file `setup` writes for a new project: the given
 * minimum, {@link RECOMMENDED_PASSWORD_MIN_LENGTH} when none was given, and an
 * empty `config`, which enforces nothing, for an explicit "none".
 */
export function passwordPolicyFile(
  minLength?: PasswordMinLength,
): PolicyFile & { $schema: string } {
  const value = minLength === undefined ? RECOMMENDED_PASSWORD_MIN_LENGTH : minLength;
  return {
    $schema: POLICY_FILE_SCHEMA_REF,
    operation: PASSWORD_POLICY_OPERATION,
    config: value === null ? {} : { min_length: value },
  };
}

/**
 * Reads a minimum password length the way `setup` takes one, from its flag or
 * its prompt: empty or 0 means none (`null`), anything else a whole number the
 * template's bounds accept. The bounds come from the generated publish body,
 * so the CLI and the server cannot disagree on them.
 */
export function parsePasswordMinLength(value: string): Parsed<PasswordMinLength> {
  const text = value.trim();
  // A minimum of 0 enforces nothing, so it means none: the file keeps one
  // form for "off", the setting left out, which its bounds (1 and up) teach.
  if (text === "" || /^0+$/.test(text)) {
    return { ok: true, value: null };
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

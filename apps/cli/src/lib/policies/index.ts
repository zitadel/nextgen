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
import type { PublishPolicyBody } from "@zitadel/api/generated/model";
import { policyConfigSchema } from "@zitadel/config/schemas";

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

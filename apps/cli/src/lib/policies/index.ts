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
import type { PublishPolicyBody } from "@zitadel/api/generated/model";

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

/**
 * Public surface for the doctor sanity checks. The `doctor` command imports
 * {@link SANITY_CHECKS} and runs every entry, aggregating the outcomes. Each
 * check is a small standalone class (see its own file); add a new diagnostic
 * by writing a class and appending an instance to the registry below.
 */
import { ClaimCheck } from "./claim";
import { ConfigCheck } from "./config";
import { DependencyCheck } from "./dependency";
import { DependencyVersionCheck } from "./dependency-version";
import { EnvExampleCheck } from "./env-example";
import { FrameworkCheck } from "./framework";
import { GitignoreCheck } from "./gitignore";
import { IssuerOriginCheck } from "./issuer-origin";
import { ManagedFilesCheck } from "./managed-files";
import { MetaSchemasCheck } from "./meta-schemas";
import { ProjectMatchCheck } from "./project-match";
import { SchemaCheck } from "./schema";
import { SecretCheck } from "./secret";
import { SecretPermissionsCheck } from "./secret-permissions";
import type { SanityCheck } from "./types";

export { ClaimCheck } from "./claim";
export { checkCliVersion } from "./cli-version";
export { ConfigCheck } from "./config";
export { DependencyCheck } from "./dependency";
export { DependencyVersionCheck } from "./dependency-version";
export { EnvExampleCheck } from "./env-example";
export { FrameworkCheck } from "./framework";
export { GitignoreCheck } from "./gitignore";
export { IssuerOriginCheck } from "./issuer-origin";
export { ManagedFilesCheck } from "./managed-files";
export { MetaSchemasCheck } from "./meta-schemas";
export { ProjectMatchCheck } from "./project-match";
export { SchemaCheck } from "./schema";
export { SecretCheck } from "./secret";
export { SecretPermissionsCheck } from "./secret-permissions";
export type { CheckContext, CheckOutcome, SanityCheck } from "./types";
export { AbstractSanityCheck } from "./types";

/** Every diagnostic the `doctor` command runs, in display order. */
export const SANITY_CHECKS: ReadonlyArray<SanityCheck> = [
  new ConfigCheck(),
  new SecretCheck(),
  new SecretPermissionsCheck(),
  new GitignoreCheck(),
  new EnvExampleCheck(),
  new FrameworkCheck(),
  new SchemaCheck(),
  new DependencyCheck(),
  new DependencyVersionCheck(),
  new ManagedFilesCheck(),
  new MetaSchemasCheck(),
  new ProjectMatchCheck(),
  new IssuerOriginCheck(),
  new ClaimCheck(),
];

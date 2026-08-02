/**
 * Public surface for the doctor sanity checks. The `doctor` command imports
 * {@link SANITY_CHECKS} and runs every entry, aggregating the outcomes. Each
 * check is a small standalone class (see its own file); add a new diagnostic
 * by writing a class and appending an instance to the registry below.
 */
import type { SanityCheck } from "./types";
import { ConfigCheck } from "./config";
import { SecretCheck } from "./secret";
import { SecretPermissionsCheck } from "./secret-permissions";
import { GitignoreCheck } from "./gitignore";
import { EnvExampleCheck } from "./env-example";
import { FrameworkCheck } from "./framework";
import { DependencyCheck } from "./dependency";
import { ManagedFilesCheck } from "./managed-files";
import { ProjectMatchCheck } from "./project-match";
import { SchemaCheck } from "./schema";

export type { SanityCheck, CheckContext, CheckOutcome } from "./types";
export { AbstractSanityCheck } from "./types";
export { ConfigCheck } from "./config";
export { SecretCheck } from "./secret";
export { SecretPermissionsCheck } from "./secret-permissions";
export { GitignoreCheck } from "./gitignore";
export { EnvExampleCheck } from "./env-example";
export { FrameworkCheck } from "./framework";
export { SchemaCheck } from "./schema";
export { DependencyCheck } from "./dependency";
export { ManagedFilesCheck } from "./managed-files";
export { ProjectMatchCheck } from "./project-match";

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
  new ManagedFilesCheck(),
  new ProjectMatchCheck(),
];

/**
 * Public surface for the oclif glue layer. Every command file imports
 * {@link BaseCommand} (and the envelope types) from here so the wiring between
 * oclif and the Zitadel envelope contract (ADR 004) is in one place.
 */
export { type Admitted, BaseCommand, type MetaOptions } from "./base";
export { atLeastOne, excludes, needs, refuses, type Rule } from "./rules";
export type { Refusal } from "./refusal";
export { ends, type Requirement, requirement, unmet } from "./requirements";
export {
  EnvironmentCommand,
  PREVIEW_CREDENTIAL,
  PreviewCommand,
} from "./environment-command";
export { CREDENTIALS, type CredentialKind } from "./credentials";
export { AuthMethodCommand, type Permit } from "./auth-method-command";
export { CommandGroups, type CommandGroup } from "./groups";
export { integerFlag, nonBlankArg, nonBlankString, portFlag } from "./flags";
export { previewFlags } from "./environment-flags";
export type {
  CommandResult,
  ConnectOptions,
  Connection,
  EnvelopeMeta,
  ErrorEnvelope,
  GlobalOptions,
  JsonEnvelope,
  OkEnvelope,
  SkippedEnvelope,
} from "./types";

/**
 * Public surface for the oclif glue layer. Every command file imports
 * {@link BaseCommand} (and the envelope types) from here so the wiring between
 * oclif and the Zitadel envelope contract (ADR 004) is in one place.
 */
export { type Admitted, BaseCommand, type MetaOptions } from "./base";
export type { Refusal } from "./refusal";
export {
  EnvironmentCommand,
  PREVIEW_CREDENTIAL,
  PreviewCommand,
} from "./environment-command";
export { CREDENTIALS, type CredentialKind } from "./credentials";
export { CommandGroups, type CommandGroup } from "./groups";
export { nonBlankArg, nonBlankString } from "./flags";
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

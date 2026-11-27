/**
 * Public surface for the oclif glue layer. Every command file imports
 * {@link BaseCommand} (and the envelope types) from here so the wiring between
 * oclif and the Zitadel envelope contract (ADR 004) is in one place.
 */
export { type Admitted, BaseCommand, type MetaOptions } from "./base";
export { CREDENTIALS } from "./credentials";
export {
  EnvironmentCommand,
  PREVIEW_CREDENTIAL,
  PreviewCommand,
} from "./environment-command";
export { nonBlankArg, nonBlankString } from "./flags";

export type {
  CommandResult,
  Connection,
  ConnectOptions,
  GlobalOptions,
  JsonEnvelope,
} from "./types";

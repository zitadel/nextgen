/**
 * Public surface for the oclif glue layer. Every command file imports
 * {@link BaseCommand} (and the envelope types) from here so the wiring between
 * oclif and the Zitadel envelope contract (ADR 004) is in one place.
 */
export { BaseCommand } from "./base";
export { EnvironmentCommand, PreviewCommand, type Connection } from "./environment-command";
export { OwnerCommand } from "./owner-command";
export { CommandGroups, type CommandGroup } from "./groups";
export { nonBlankArg, nonBlankString } from "./flags";
export { previewFlags } from "./environment-flags";
export type {
  CommandResult,
  EnvelopeMeta,
  ErrorEnvelope,
  GlobalOptions,
  JsonEnvelope,
  OkEnvelope,
  SkippedEnvelope,
} from "./types";

import type { EnvironmentKey } from "../environment";

/**
 * The credentials a command can authenticate with, and the variable each one
 * is read from. A command declares which one it needs (`static credential` on
 * {@link import("./environment-command").EnvironmentCommand}); the other is
 * never tried in its place, because a token that works but carries the wrong
 * reach is worse than a command that stops and names the variable it wants.
 */
export const CREDENTIALS = {
  project: "ZITADEL_PROJECT_SECRET",
  preview: "ZITADEL_PREVIEW_TOKEN",
} as const satisfies Record<string, EnvironmentKey>;

export type CredentialKind = keyof typeof CREDENTIALS;

import type { EnvironmentKey } from "../environment";

/**
 * The credentials a command can authenticate with, and the variable each one
 * is read from. A command declares which one it needs (`static credential` on
 * {@link import("./environment-command").EnvironmentCommand}); the other is
 * never tried in its place, because a token that works but carries the wrong
 * reach is worse than a command that stops and names the variable it wants.
 * The same holds for the developer's own sign-in, which may stand in for the
 * secret: whichever one a run chose, a refusal of it is final.
 */
export const CREDENTIALS = {
  project: "ZITADEL_PROJECT_SECRET",
  preview: "ZITADEL_PREVIEW_TOKEN",
} as const satisfies Record<string, EnvironmentKey>;

export type CredentialKind = keyof typeof CREDENTIALS;

/**
 * What a command connected with, as its envelope's `credential` names it: the
 * kind of secret it read, or `login`, the person `zitadel login` signed in.
 */
export type CredentialUsed = CredentialKind | "login";

/** A person's sign-in at a server: the bearer token it presents, and whom it names. */
export type SignIn = Readonly<{ token: string; who: string }>;

/**
 * Finds the person signed in to `server`, with a token that still lives, or
 * `undefined` when nobody is. A sign-in the server refuses to refresh throws:
 * it is over, and no other credential is tried in its place.
 */
export type SignInLookup = (
  server: string,
  run: Readonly<{ env: NodeJS.ProcessEnv; signal: AbortSignal }>,
) => Promise<SignIn | undefined>;

/** Nobody is signed in anywhere: the lookup until the CLI registers its own. */
const NOBODY: SignInLookup = async () => undefined;

let lookUpSignIn: SignInLookup = NOBODY;

/**
 * Registers how the CLI finds a person's sign-in, and returns the lookup it
 * replaces. Sign-ins are kept by `lib/login`, which this layer may not import
 * (`tests/unit/lib/oclif/layering.test.ts`), so the CLI's command table
 * (`src/index.ts`) hands the lookup in as it loads, before oclif runs any
 * command. A command built from source without it sees nobody signed in.
 */
export function registerSignInLookup(lookup: SignInLookup): SignInLookup {
  const replaced = lookUpSignIn;
  lookUpSignIn = lookup;
  return replaced;
}

/** The person signed in to `server`, through the lookup {@link registerSignInLookup} registered. */
export function signInAt(
  server: string,
  run: Readonly<{ env: NodeJS.ProcessEnv; signal: AbortSignal }>,
): Promise<SignIn | undefined> {
  return lookUpSignIn(server, run);
}

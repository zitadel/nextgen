/**
 * Module-global bearer token used by the orval-generated client's
 * custom fetch. Set once at command boot (the same lifecycle pattern
 * as `base-url.ts`); every generated request reads from here.
 *
 * Keeping the token here means the CLI doesn't have to thread an
 * `Authorization` header through every generated call site; orval's
 * `mutator` wires `runtime/fetch.ts` in, and that file pulls the token
 * from this module.
 */
let apiAuthToken: string | undefined;

export function getApiAuthToken(): string | undefined {
  return apiAuthToken;
}

export function setApiAuthToken(token: string | undefined): void {
  apiAuthToken = token;
}

/**
 * The request header that names which environment of the project serves a
 * public request: `live` or a preview environment. Absent, the server
 * resolves the environment from the request origin.
 */
export const ENVIRONMENT_HEADER = "X-Zitadel-Environment";

/**
 * The request header that pins which configuration release serves a public
 * request. `latest` (or absent) means the release the resolved environment
 * currently runs; a release id must already be deployed to that environment.
 */
export const RELEASE_HEADER = "X-Zitadel-Release";

/**
 * Module-global environment selector, sent as {@link ENVIRONMENT_HEADER} on
 * every generated request while set. Same lifecycle as the bearer token.
 */
let apiEnvironmentSelector: string | undefined;

export function getApiEnvironmentSelector(): string | undefined {
  return apiEnvironmentSelector;
}

export function setApiEnvironmentSelector(environment: string | undefined): void {
  apiEnvironmentSelector = environment;
}

/**
 * Module-global release selector, sent as {@link RELEASE_HEADER} on every
 * generated request while set. Same lifecycle as the bearer token: the
 * client factory sets it per call from the handle it was built for.
 */
let apiReleaseSelector: string | undefined;

export function getApiReleaseSelector(): string | undefined {
  return apiReleaseSelector;
}

export function setApiReleaseSelector(release: string | undefined): void {
  apiReleaseSelector = release;
}

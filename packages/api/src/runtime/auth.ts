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

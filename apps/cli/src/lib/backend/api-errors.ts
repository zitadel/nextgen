/**
 * What the server answered with, as the API package throws it: one class for
 * each error code the spec names, and the {@link ApiError} they extend. Reached
 * from here so nothing outside the backend names the generated package.
 */
export * from "@zitadel/api/generated/errors";
export { ApiError, apiErrorCode } from "@zitadel/api/runtime/fetch";

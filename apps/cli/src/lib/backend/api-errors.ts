/**
 * What the server answered with, as the API package throws it: one class for
 * each error code the spec names, and the {@link ApiError} they extend. Reached
 * from here so nothing outside the backend names the generated package.
 *
 * @remarks
 * The spec's `unavailable` code makes a class of the same name as the backend's
 * own {@link UnavailableError}, which stands for a request that got no usable
 * answer. The index exports the backend's, so the spec's is reached from this
 * module as `UnavailableError` when it is wanted.
 */
export * from "@zitadel/api/generated/errors";
export { ApiError, apiErrorCode } from "@zitadel/api/runtime/fetch";

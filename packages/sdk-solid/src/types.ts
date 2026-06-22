/**
 * Re-exports the shared SPA widget types from `@zitadel/sdk-core`.
 *
 * `export type *` keeps this surface in lockstep with the core SPA contract: a
 * type added there is re-exported here automatically, and none can be dropped by
 * hand. The server-middleware types live in a separate core module and stay out
 * of the browser SDK surface.
 */
export type * from "@zitadel/sdk-core/types";

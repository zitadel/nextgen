/**
 * The namespace the server publishes its built-in schemas under, its default
 * `schema.builtin_public_base`. A module of its own, so the workspace's schema
 * renderer can be held to it without loading the rest of the defaults.
 */
export const DEFAULT_BUILTIN_SCHEMA_BASE = "https://zitadel.com/schemas/v1";

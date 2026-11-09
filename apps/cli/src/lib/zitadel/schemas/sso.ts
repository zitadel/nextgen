/**
 * The edits that enable a provider on a user schema, where it becomes one of
 * the schema's `sso` providers, and the edit that takes one away again. Only
 * `x-auth-methods.sso` is ever written.
 */

import type { ConnectionSlug } from "@zitadel/config/idp";

import type { EditResult, JsonObject } from "@/lib/zitadel/types";
import { isJsonObject, objectAt } from "@/lib/zitadel/utils/json";

/**
 * Why a user schema cannot be edited to offer a provider, or `undefined` when
 * it can.
 *
 * @param schema - The user schema.
 * @returns The reason, or `undefined`.
 */
export function schemaEditRefusal(schema: JsonObject): string | undefined {
  const methods = schema["x-auth-methods"];
  if (methods === undefined) {
    return undefined;
  }
  if (!isJsonObject(methods)) {
    return "x-auth-methods is not an object";
  }
  if (methods.sso === undefined) {
    return undefined;
  }
  if (!isJsonObject(methods.sso)) {
    return "x-auth-methods.sso is not an object";
  }
  // The meta-schema requires a boolean. A missing one or a string "true" is
  // neither on nor off, so it is refused rather than overwritten.
  if (typeof methods.sso.enabled !== "boolean") {
    return "x-auth-methods.sso.enabled is not a boolean";
  }
  if (methods.sso.providers !== undefined && !Array.isArray(methods.sso.providers)) {
    return "x-auth-methods.sso.providers is not a list";
  }
  return undefined;
}

/**
 * Enable the provider on a user schema.
 *
 * Only `x-auth-methods.sso` is touched: password and passkey configuration
 * belongs to whoever set it, and a provider is added to the list rather than
 * replacing it, so enabling a second one later keeps the first.
 *
 * @param schema - The user schema.
 * @param slug - The provider to enable.
 * @returns The schema with the provider enabled.
 */
export function addSsoToSchema(schema: JsonObject, slug: ConnectionSlug): EditResult {
  const methods = objectAt(schema, "x-auth-methods");
  const existing = isJsonObject(methods.sso) ? methods.sso : undefined;
  const providers: readonly unknown[] = Array.isArray(existing?.providers)
    ? existing.providers
    : [];
  if (existing?.enabled === true && providers.includes(slug)) {
    return { body: schema, changed: false, skipped: [] };
  }
  const listed = providers.includes(slug) ? providers : [...providers, slug];
  // A key spread over its own keeps its place, so the file's key order holds.
  const body = structuredClone({
    ...schema,
    "x-auth-methods": { ...methods, sso: { ...existing, enabled: true, providers: listed } },
  });
  return { body, changed: true, skipped: [] };
}

/**
 * Remove a provider from a user schema.
 *
 * Only `x-auth-methods.sso` is touched. The provider leaves the list, and when
 * none is left `sso` becomes `{ "enabled": false }`: the meta-schema requires
 * at least one provider whenever the list is present. A provider the schema
 * does not offer is a no-op.
 *
 * @param schema - The user schema.
 * @param slug - The provider to remove.
 * @returns The schema without the provider.
 */
export function removeSsoFromSchema(schema: JsonObject, slug: string): EditResult {
  const methods = objectAt(schema, "x-auth-methods");
  const sso = methods.sso;
  if (!isJsonObject(sso) || !Array.isArray(sso.providers) || !sso.providers.includes(slug)) {
    return { body: schema, changed: false, skipped: [] };
  }
  const providers = sso.providers.filter((provider) => {
    return provider !== slug;
  });
  const next = providers.length === 0 ? { enabled: false } : { ...sso, providers };
  const body = structuredClone({ ...schema, "x-auth-methods": { ...methods, sso: next } });
  return { body, changed: true, skipped: [] };
}

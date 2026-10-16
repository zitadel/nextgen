import { api } from "@/api/zitadel";
import type { UserSchema } from "./schema";
import { sessionCached } from "./session-cache";

/**
 * The schema the signed-in person's own record is validated against, from the
 * self-access `GET /users/me/schema`: what Profile is generated from, and what
 * `PATCH /users/me` validates against. No grant needed, so it answers for a
 * platform user who holds none.
 */
export const readOwnUserSchema = sessionCached(
  async () => (await api.getMyUserSchema()).schema as UserSchema,
  5 * 60_000,
);

/**
 * The attribute a person's name lives in, if their schema has one: the first
 * `x-display` designation (ADR 058) when it is a top-level string property.
 */
export function displayNameProperty(schema: UserSchema | undefined): string | undefined {
  const doc = schema as
    | { "x-display"?: unknown; properties?: Record<string, { type?: unknown }> }
    | undefined;
  const first = Array.isArray(doc?.["x-display"]) ? doc["x-display"][0] : undefined;
  if (typeof first !== "string" || first.includes(".")) return undefined;
  return doc?.properties?.[first]?.type === "string" ? first : undefined;
}

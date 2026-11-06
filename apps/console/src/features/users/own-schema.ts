import { api } from "@/api/zitadel";
import { consoleSessionProject } from "@/auth/session";
import type { UserSchema } from "@/features/schemas/model";
import { sessionCached } from "@/lib/session-cache";

/**
 * The schema the signed-in person's own record is validated against, from the
 * self-access `GET /users/me/schema`: what Profile is generated from, and what
 * `PATCH /users/me` validates against. No grant needed, so it answers for a
 * platform user who holds none.
 */
export const readOwnUserSchema = sessionCached(
  async () => (await api.getMyUserSchema(consoleSessionProject())).schema as UserSchema,
  5 * 60_000,
);

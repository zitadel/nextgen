import { randomUUID } from "node:crypto";

import type { ZitadelClient } from "@zitadel/api/client";

import { requireString } from "./bootstrap";
import type { SeededUser, SeedUserInput } from "./types";

export interface SeedContext {
  projectId: string;
  schemaId: string;
}

/**
 * Create a user that can immediately complete the password login flow:
 * `POST /users` (the body must carry `$schema: <schema id>`) followed by
 * `PUT /users/{id}/password` with `isChangeRequired: false`.
 *
 * Defaults mint a unique email per call (email is x-unique per project), which
 * is what makes per-test seeding parallel-safe on a shared instance.
 */
export async function seedUser(
  client: ZitadelClient,
  context: SeedContext,
  input: SeedUserInput = {},
): Promise<SeededUser> {
  const email = input.email ?? `e2e-${randomUUID().slice(0, 8)}@example.com`;
  const password = input.password ?? `Pw!${randomUUID()}`;
  // Reserved fields win over attributes: the returned SeededUser must never
  // disagree with what was actually created (a silently overridden email or
  // $schema would yield credentials that cannot log in).
  const user = (await client.createUser(
    {
      ...input.attributes,
      $schema: context.schemaId,
      email,
    } as Parameters<ZitadelClient["createUser"]>[0],
    { project_id: context.projectId },
  )) as Record<string, unknown>;
  const id = requireString(user.id, "user id");
  await client.setUserPassword(
    id,
    { password, isChangeRequired: false },
    { project_id: context.projectId },
  );
  return { id, email, password };
}

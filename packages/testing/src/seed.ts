import { randomUUID } from "node:crypto";

import type { ZitadelClient } from "@zitadel/api/client";

import { requireString } from "./bootstrap";
import type { Identity, SeededUser, SeedUserInput, SeedUsersTemplate } from "./types";

export interface SeedContext {
  projectId: string;
  schemaId: string;
}

/**
 * A unique unused email + password. Nothing is created on the instance —
 * this is the input for registration-flow specs, which must prove the flow
 * creates the user.
 */
export function identity(): Identity {
  return {
    email: `e2e-${randomUUID().slice(0, 8)}@example.com`,
    password: `Pw!${randomUUID()}`,
  };
}

/**
 * Create a user that can immediately complete the password login flow:
 * `POST /users` (the body carries `schema: <schema id>` and the schema-defined
 * content under `attributes`) followed by `PUT /users/{id}/password` with
 * `is_change_required: false`.
 *
 * Defaults mint a unique email per call (email is x-unique per project), which
 * is what makes per-test seeding parallel-safe on a shared instance.
 */
export async function seedUser(
  client: ZitadelClient,
  context: SeedContext,
  input: SeedUserInput = {},
): Promise<SeededUser> {
  const fresh = identity();
  const email = input.email ?? fresh.email;
  const password = input.password ?? fresh.password;
  // `email` wins over the templated attributes: the returned SeededUser must
  // never disagree with what was actually created, since a silently overridden
  // email would yield credentials that cannot log in.
  const user = (await client.createUser(
    {
      schema: context.schemaId,
      attributes: { ...input.attributes, email },
    },
    { project_id: context.projectId },
  )) as Record<string, unknown>;
  const id = requireString(user.id, "user id");
  await client.setUserPassword(id, { password, is_change_required: false });
  return { id, email, password };
}

/**
 * Seed `count` users sequentially. The template makes fixture data
 * deterministic per index (stable emails/names keep screenshot diffs about
 * code, not reshuffled data — the `console:dev-real` pattern); untemplated
 * fields fall back to the unique defaults. Name-like attributes need a
 * schema that declares them (`useCase: "consumer"` or wider).
 */
export async function seedUsers(
  client: ZitadelClient,
  context: SeedContext,
  count: number,
  template: SeedUsersTemplate = {},
): Promise<SeededUser[]> {
  const users: SeededUser[] = [];
  for (let index = 0; index < count; index += 1) {
    users.push(
      await seedUser(client, context, {
        email: template.email?.(index),
        password: template.password?.(index),
        attributes: template.attributes?.(index),
      }),
    );
  }
  return users;
}

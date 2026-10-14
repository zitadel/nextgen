import { useEffect, useState } from "react";

import { api } from "@/api/zitadel";
import { field } from "./record";
import { sessionCached } from "./session-cache";

/**
 * The attribute a person's name lives in, when their schema has one: the
 * first `x-display` designation (ADR 058), if it is a top-level string — what
 * `display` on every user-ref renders. The platform project's schema declares
 * `name`; the shipped default declares none, and then the console offers no
 * name, since one saved there would never be shown anywhere.
 *
 * Read without a project id, so it resolves in the session's own project —
 * the one the person's user lives in. A refused or failed read is the same as
 * no name.
 */
export async function displayNameProperty(
  schemaId: string | undefined,
): Promise<string | undefined> {
  if (!schemaId) return undefined;
  try {
    const { schema } = await api.getSchemaById(schemaId);
    const doc = schema as {
      "x-display"?: unknown;
      properties?: Record<string, { type?: unknown }>;
    };
    const first = Array.isArray(doc["x-display"]) ? doc["x-display"][0] : undefined;
    if (typeof first !== "string" || first.includes(".")) return undefined;
    return doc.properties?.[first]?.type === "string" ? first : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether the signed-in person can name themselves: their own record's schema
 * designates a display name. Shared by the account menu's "Add your name"
 * prompt, and dropped with the session like every per-person read.
 */
const readOwnDisplayNameProperty = sessionCached(async () => {
  const user = await api.getMyUser();
  return displayNameProperty(field(user, "schema"));
}, 5 * 60_000);

/** {@link readOwnDisplayNameProperty} for a component: `undefined` until known, or when there is none. */
export function useOwnDisplayNameProperty(enabled: boolean): string | undefined {
  const [property, setProperty] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    readOwnDisplayNameProperty()
      .then((value) => {
        if (!cancelled) setProperty(value);
      })
      .catch(() => {
        if (!cancelled) setProperty(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return property;
}

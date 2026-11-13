import { ApiError } from "@zitadel/api/runtime/fetch";
import { useEffect, useState } from "react";

import { api } from "@/api/zitadel";
import { sessionCached, sessionKept } from "@/lib/session-cache";
import { getPlatformProjectId } from "@/runtime/runtime";

/**
 * The last answer {@link readPlatformAccess} gave (`null`: none), so a sidebar
 * list that mounts again (every move between lists does) starts from it rather
 * than drawing its rows a moment later. Dropped with the session.
 */
const lastAnswer = sessionKept((): { value: string | null | undefined } => ({ value: undefined }));

/**
 * Whether the signed-in person may act on the reserved platform project, the
 * console's root (D42, Console ADR 0004 §5 amendment).
 *
 * Its screens are a project's screens, and rows of the root sidebar only for
 * someone who can, which a platform operator always can (root ADR 075) and a
 * cloud customer, holding no grant there, never can. Only they may have it
 * selected (`routes/_authed.tsx`). Signing in to the project, or being homed
 * in it, is not that: the server answers it, from the person's grants, by
 * reading the project. Each screen's own reads then decide what it shows.
 *
 * Until effective permissions are exposed (ADR 0004 §5), the read is the
 * project itself, `GET /projects/{id}`: refused (403, 404) for anyone who
 * cannot act on it.
 */
export const readPlatformAccess = sessionCached(async (): Promise<string | undefined> => {
  const id = getPlatformProjectId();
  if (!id) return undefined;
  try {
    await api.getProject(id);
    lastAnswer().value = id;
    return id;
  } catch (cause) {
    if (cause instanceof ApiError && (cause.status === 403 || cause.status === 404)) {
      lastAnswer().value = null;
      return undefined;
    }
    throw cause;
  }
}, 60_000);

/**
 * The reserved platform project's id when the person may act on it, for the
 * chrome (the root sidebar, search): `undefined` while the first read is in
 * flight, where the deployment has none, and when it is refused or fails, so
 * its screens are simply not listed.
 */
export function usePlatformAccess(): string | undefined {
  const platform = getPlatformProjectId();
  const [read, setRead] = useState<string | null | undefined>(() =>
    platform ? lastAnswer().value : null,
  );
  useEffect(() => {
    if (!platform) return;
    let cancelled = false;
    readPlatformAccess().then(
      (id) => {
        if (!cancelled) setRead(id ?? null);
      },
      () => {
        if (!cancelled) setRead(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [platform]);
  return read ?? undefined;
}

/**
 * What a link up to one of the root's screens carries (D44): the platform
 * project for someone who may act on it, and otherwise no selection, which
 * `undefined` removes from the retained `?project=`. The `_authed` guard
 * would set it anyway; the link saves the redirect.
 */
export function useRootSearch(): { project: string | undefined } {
  return { project: usePlatformAccess() };
}

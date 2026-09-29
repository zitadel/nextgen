import type { ZitadelProject } from "@zitadel/sdk-react";
import { useMemo } from "react";

import { apiBase } from "../api/zitadel";
import { getConsoleProjectId, getPublishableKey } from "../runtime/runtime";

/**
 * The per-element `ZitadelProject` handle a console screen hands to a
 * `<zitadel-login>` it mounts itself (sign-in, the branding preview).
 *
 * Built from the runtime-discovered project id (Console ADR 0004 §3), not
 * from the app-wide `configureZitadel()` handle: that one carries only the
 * build-time env override, which is empty in the embedded build, and the
 * element's own `project` property wins over the global config — so passing
 * the app-wide handle would make the element refuse to start a flow. The
 * runtime-discovered publishable key (root ADR 036) lets the element send the
 * public-plane bearer itself.
 *
 * Stable per config tuple: a fresh object every render would re-set the
 * element property and miss the SDK's per-handle client cache. `undefined`
 * until discovery has produced a project id.
 */
export function useConsoleProject(): ZitadelProject | undefined {
  const projectId = getConsoleProjectId();
  const publishableKey = getPublishableKey();
  return useMemo<ZitadelProject | undefined>(
    () =>
      projectId ? Object.freeze({ projectId, proxyPath: apiBase, publishableKey }) : undefined,
    [projectId, publishableKey],
  );
}

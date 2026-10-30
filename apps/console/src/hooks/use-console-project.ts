import type { ZitadelProject } from "@zitadel/sdk-react";
import { useMemo } from "react";

import { addon } from "@/addon";
import { apiBase } from "@/api/zitadel";
import { getConsoleProjectId, getPublishableKey } from "@/runtime/runtime";

/**
 * The per-element `ZitadelProject` handle the sign-in screen hands to the
 * `<zitadel-login>` it mounts. The branding preview does not use it: that one
 * runs in the selected project (`lib/project-scope.ts`), not the sign-in one.
 *
 * Built from the runtime-discovered project id (Console ADR 0004 §3), not
 * from the app-wide `configureZitadel()` handle: that one is configured before
 * discovery and carries no project id, and the element's own `project`
 * property wins over the global config — so passing the app-wide handle would
 * make the element refuse to start a flow. The
 * runtime-discovered publishable key (root ADR 036) lets the element send the
 * public-plane bearer itself.
 *
 * The build's add-on may route the widget's calls elsewhere on the origin
 * (`signInApiBase`, Console ADR 0006 §2); the hosted cloud's puts its bot check
 * in front of the server there.
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
      projectId
        ? Object.freeze({ projectId, proxyPath: addon.signInApiBase ?? apiBase, publishableKey })
        : undefined,
    [projectId, publishableKey],
  );
}

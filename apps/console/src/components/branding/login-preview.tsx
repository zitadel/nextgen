import "@zitadel/components";

import type { Branding, ZitadelLogin } from "@zitadel/components";
import type { ZitadelProject } from "@zitadel/sdk-react";
import { useEffect, useMemo, useRef } from "react";

import { apiBase } from "../../api/zitadel";
import { getConsoleProjectId, getPublishableKey } from "../../runtime/runtime";

export type PreviewJourney = "register" | "login";

type Props = {
  /** The unpublished branding to paint. */
  draft: Branding;
  /** Which journey the preview walks. */
  journey: PreviewJourney;
  /** Flow definition name, empty for the project's default. */
  flowName: string;
  /** Which side to show, or `auto` to follow the viewer. */
  theme: "light" | "dark" | "auto";
};

/**
 * The real `<zitadel-login>`, against a real flow on this project.
 *
 * A stubbed step would drift from the flow definition the project actually
 * serves, which is the thing a customer is checking their branding against.
 * The element is fed the draft through `brandingOverride`, so what renders is
 * the unpublished edit over the live flow; nothing here publishes.
 *
 * Mounted imperatively rather than as JSX: `project` and `draft` are objects,
 * which reach a custom element as properties, and the element starts its flow
 * on connect — so a journey change has to build a new one rather than mutate
 * the old.
 */
export function LoginPreview({ draft, journey, flowName, theme }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const element = useRef<ZitadelLogin | null>(null);

  // Built from the runtime-discovered id, as the sign-in screen does, not from
  // the app-wide handle: that one carries the build-time env override, which is
  // empty in the embedded build, and the element's own `project` property wins
  // over the global config — so passing it would make the preview refuse to
  // start a flow at `/ui/console/branding`.
  const projectId = getConsoleProjectId();
  const publishableKey = getPublishableKey();
  const project = useMemo<ZitadelProject | undefined>(
    () =>
      projectId ? Object.freeze({ projectId, proxyPath: apiBase, publishableKey }) : undefined,
    [projectId, publishableKey],
  );

  useEffect(() => {
    const container = host.current;
    if (!container || !project) return;
    const login = document.createElement("zitadel-login") as ZitadelLogin;
    login.variant = "widget";
    login.purpose = journey;
    login.flowName = flowName;
    login.project = project;
    // Set before it connects: a fresh element would otherwise paint the live
    // revision until the next edit, so switching journey or flow would drop
    // the draft being previewed.
    login.brandingOverride = draft;
    login.theme = theme;
    container.replaceChildren(login);
    element.current = login;
    return () => {
      login.remove();
      element.current = null;
    };
    // `draft` and `theme` are seeded here but deliberately not remount keys:
    // an edit repaints the element below rather than restarting its flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey, flowName, project]);

  // Separate from the mount: an edit repaints the element that is already
  // there, rather than restarting its flow.
  useEffect(() => {
    if (!element.current) return;
    element.current.brandingOverride = draft;
    element.current.theme = theme;
  }, [draft, theme]);

  return <div ref={host} />;
}

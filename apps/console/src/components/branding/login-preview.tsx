import "@zitadel/components";

import type { LoginPreviewState, ZitadelLogin } from "@zitadel/components";
import type { ZitadelProject } from "@zitadel/sdk-react";
import { useEffect, useMemo, useRef } from "react";

import { apiBase } from "../../api/zitadel";
import { useRequiredProjectScope } from "../../lib/project-scope";

export type PreviewJourney = "register" | "login";

export type PreviewState = LoginPreviewState;

type Props = {
  /** Which journey the preview walks. */
  journey: PreviewJourney;
  /** Flow definition name, empty for the project's default. */
  flowName: string;
  /** Which side to show, or `revision` to let the branding's own `theme.mode` decide. */
  theme: "light" | "dark" | "revision";
  /** The state the element shows the step in. */
  state: PreviewState;
  /** The flow's terminal step, which the success state paints; the element's default when unset. */
  successStep?: string;
};

/**
 * The real `<zitadel-login>`, against a real flow on the selected project.
 *
 * A stubbed step would drift from the flow definition the project actually
 * serves, which is the thing a customer is checking their branding against.
 * The flow response carries the revision in use, so the element paints it the
 * way it does for a visitor; nothing here is passed in beside the flow. The
 * element's preview mode then shows that step in the chosen state and never
 * submits, so the screen writes nothing to the project.
 *
 * The handle names the selected project and carries no publishable key: the
 * console only discovers its sign-in project's key (Console ADR 0004 §3), and
 * the flow endpoints take the project id alone. The session cookie rides along
 * as on every other console request.
 *
 * Typography is the one thing a visitor sees that this does not: the element
 * mounts as a `widget`, and a widget never injects a font stylesheet into the
 * document that embeds it (the host owns its fonts and its CSP).
 *
 * Mounted imperatively rather than as JSX: `project` is an object, which
 * reaches a custom element as a property, and the element starts its flow on
 * connect — so a journey change has to build a new one rather than mutate the
 * old.
 */
export function LoginPreview({ journey, flowName, theme, state, successStep = "" }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const element = useRef<ZitadelLogin | null>(null);

  const projectId = useRequiredProjectScope();
  // Stable per project: a fresh object every render would re-set the element
  // property and miss the SDK's per-handle client cache.
  const project = useMemo<ZitadelProject>(
    () => Object.freeze({ projectId, proxyPath: apiBase }),
    [projectId],
  );

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const login = document.createElement("zitadel-login") as ZitadelLogin;
    login.variant = "widget";
    login.purpose = journey;
    login.flowName = flowName;
    login.project = project;
    login.theme = elementTheme(theme);
    login.previewState = state;
    login.previewSuccessStep = successStep;
    container.replaceChildren(login);
    element.current = login;
    return () => {
      login.remove();
      element.current = null;
    };
    // `theme`, `state` and `successStep` are seeded here but deliberately not
    // remount keys: a switch repaints the element below rather than restarting
    // its flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey, flowName, project]);

  // Separate from the mount: a theme switch repaints the element that is
  // already there, rather than restarting its flow.
  useEffect(() => {
    if (!element.current) return;
    element.current.theme = elementTheme(theme);
  }, [theme]);

  // Likewise a state switch: the element re-derives the step it already has.
  useEffect(() => {
    if (!element.current) return;
    element.current.previewState = state;
    element.current.previewSuccessStep = successStep;
  }, [state, successStep]);

  return <div ref={host} />;
}

/**
 * An unset element `theme` lets `branding.theme.mode` govern — the element's
 * own `auto` would override the revision's mode with the OS preference.
 */
function elementTheme(theme: Props["theme"]): ZitadelLogin["theme"] {
  return theme === "revision" ? "" : theme;
}

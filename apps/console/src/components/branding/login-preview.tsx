import { type LoginPreviewState, loginPreviewStatesFor } from "@zitadel/components";
import { ZitadelLogin, type ZitadelProject } from "@zitadel/sdk-react";
import { useMemo } from "react";

import { apiBase } from "@/api/zitadel";
import { useRequiredProjectScope } from "@/lib/project-scope";

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
  /** Told which states show the served step differently from `default`, once it arrives. */
  onStates?: (states: PreviewState[]) => void;
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
 */
export function LoginPreview({ journey, flowName, theme, state, successStep, onStates }: Props) {
  const projectId = useRequiredProjectScope();
  // Stable per project: a fresh object every render would re-set the element
  // property and miss the SDK's per-handle client cache.
  const project = useMemo<ZitadelProject>(
    () => Object.freeze({ projectId, proxyPath: apiBase }),
    [projectId],
  );

  return (
    <ZitadelLogin
      // The element starts its flow once, when it mounts, so a different
      // project, journey or flow is a new element. Theme, state and success
      // step are plain props: a switch repaints the one already there.
      key={`${projectId}:${journey}:${flowName}`}
      project={project}
      variant="widget"
      purpose={journey}
      flowName={flowName}
      // Unset lets `branding.theme.mode` govern; the element's own `auto`
      // would override the revision's mode with the OS preference.
      theme={theme === "revision" ? undefined : theme}
      previewState={state}
      previewSuccessStep={successStep}
      onFlowStep={onStates && (({ step }) => onStates(loginPreviewStatesFor(step)))}
    />
  );
}

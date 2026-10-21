import { type LoginPreviewState, loginPreviewStatesFor } from "@zitadel/components";
import { ZitadelLogin, type ZitadelProject } from "@zitadel/sdk-react";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

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

/** The colours the element paints with, as its own `--zl-*` properties resolve them. */
type Ground = { background: string; foreground: string };

/**
 * The ground the preview sits on, as an embedding page would draw it: the
 * element's own background with a faint dot grid of its foreground, like the
 * website's preview. It follows the side the element actually paints — the
 * pinned one, or the branding's `theme.mode`, which `auto` resolves from the
 * visitor's OS — and any brand colours, so a light widget never sits on the
 * console's dark card or the other way round.
 *
 * The colours are read from the element (`getComputedStyle`) whenever it
 * changes side or style, or serves a step, since the revision arrives with
 * the flow. Until then the stage keeps its card colour.
 */
export function PreviewStage({
  className,
  children,
}: {
  className?: string;
  children: (onGround: (ground: Ground) => void) => ReactNode;
}) {
  const [ground, setGround] = useState<Ground>();
  const style: CSSProperties | undefined = ground && {
    backgroundColor: ground.background,
    backgroundImage: `radial-gradient(color-mix(in srgb, ${ground.foreground} 9%, transparent) 1px, transparent 1px)`,
    backgroundSize: "1rem 1rem",
    backgroundPosition: "center",
  };
  return (
    <div className={className} style={style}>
      {children(setGround)}
    </div>
  );
}

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
export function LoginPreview({
  journey,
  flowName,
  theme,
  state,
  successStep,
  onStates,
  onGround,
}: Props & { onGround?: (ground: Ground) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const read = useRef<() => void>(() => undefined);
  read.current = () => {
    const element = root.current?.querySelector("zitadel-login");
    if (!element || !onGround) return;
    const style = getComputedStyle(element);
    const background = style.getPropertyValue("--zl-background").trim();
    const foreground = style.getPropertyValue("--zl-foreground").trim();
    if (background && foreground) onGround({ background, foreground });
  };
  // A new element on a new key, and its side or style on the one there.
  useEffect(() => {
    const container = root.current;
    if (!container) return;
    const observer = new MutationObserver(() => read.current());
    observer.observe(container, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-theme", "style", "theme"],
    });
    read.current();
    return () => observer.disconnect();
  }, []);

  const projectId = useRequiredProjectScope();
  // Stable per project: a fresh object every render would re-set the element
  // property and miss the SDK's per-handle client cache.
  const project = useMemo<ZitadelProject>(
    () => Object.freeze({ projectId, proxyPath: apiBase }),
    [projectId],
  );

  return (
    <div ref={root} className="contents">
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
        onFlowStep={({ step }) => {
          onStates?.(loginPreviewStatesFor(step));
          // The step carries the revision; its colours are on the element now.
          read.current();
        }}
      />
    </div>
  );
}

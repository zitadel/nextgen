import "@zitadel/components";

import type { Branding, ZitadelLogin } from "@zitadel/components";
import { useEffect, useRef } from "react";

import { useConsoleProject } from "../../hooks/use-console-project";

export type PreviewJourney = "register" | "login";

type Props = {
  /** The unpublished branding to paint. */
  draft: Branding;
  /** Which journey the preview walks. */
  journey: PreviewJourney;
  /** Flow definition name, empty for the project's default. */
  flowName: string;
  /** Which side to show, or `draft` to let the draft's own `theme.mode` decide. */
  theme: "light" | "dark" | "draft";
};

/**
 * The real `<zitadel-login>`, against a real flow on this project.
 *
 * A stubbed step would drift from the flow definition the project actually
 * serves, which is the thing a customer is checking their branding against.
 * The element is fed the draft through `brandingOverride`, so what renders is
 * the unpublished edit over the live flow; nothing here publishes.
 *
 * Typography is the exception: the element mounts as a `widget`, and a widget
 * never injects a font stylesheet into the document that embeds it (the host
 * owns its fonts and its CSP), so `typography.font_url` and a `font_family`
 * the console has not loaded do not show here. The panel says so beside those
 * rows; a preview that loads the face is a follow-up.
 *
 * Mounted imperatively rather than as JSX: `project` and `draft` are objects,
 * which reach a custom element as properties, and the element starts its flow
 * on connect — so a journey change has to build a new one rather than mutate
 * the old.
 */
export function LoginPreview({ draft, journey, flowName, theme }: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const element = useRef<ZitadelLogin | null>(null);

  const project = useConsoleProject();

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
    login.theme = elementTheme(theme);
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
    element.current.theme = elementTheme(theme);
  }, [draft, theme]);

  return <div ref={host} />;
}

/**
 * An unset element `theme` lets `branding.theme.mode` govern — the element's
 * own `auto` would override the draft's mode with the OS preference, hiding
 * the panel's Theme select from the preview.
 */
function elementTheme(theme: Props["theme"]): ZitadelLogin["theme"] {
  return theme === "draft" ? "" : theme;
}

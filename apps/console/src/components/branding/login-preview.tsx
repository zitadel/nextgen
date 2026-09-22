import "@zitadel/components";

import type { ZitadelLogin } from "@zitadel/components";
import { useEffect, useRef } from "react";

import { useConsoleProject } from "../../hooks/use-console-project";

export type PreviewJourney = "register" | "login";

type Props = {
  /** Which journey the preview walks. */
  journey: PreviewJourney;
  /** Flow definition name, empty for the project's default. */
  flowName: string;
  /** Which side to show, or `revision` to let the branding's own `theme.mode` decide. */
  theme: "light" | "dark" | "revision";
};

/**
 * The real `<zitadel-login>`, against a real flow on this project.
 *
 * A stubbed step would drift from the flow definition the project actually
 * serves, which is the thing a customer is checking their branding against.
 * The flow response carries the revision in use, so the element paints it the
 * way it does for a visitor; nothing here is passed in beside the flow.
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
export function LoginPreview({ journey, flowName, theme }: Props) {
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
    login.theme = elementTheme(theme);
    container.replaceChildren(login);
    element.current = login;
    return () => {
      login.remove();
      element.current = null;
    };
    // `theme` is seeded here but deliberately not a remount key: a switch
    // repaints the element below rather than restarting its flow.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journey, flowName, project]);

  // Separate from the mount: a theme switch repaints the element that is
  // already there, rather than restarting its flow.
  useEffect(() => {
    if (!element.current) return;
    element.current.theme = elementTheme(theme);
  }, [theme]);

  return <div ref={host} />;
}

/**
 * An unset element `theme` lets `branding.theme.mode` govern — the element's
 * own `auto` would override the revision's mode with the OS preference.
 */
function elementTheme(theme: Props["theme"]): ZitadelLogin["theme"] {
  return theme === "revision" ? "" : theme;
}

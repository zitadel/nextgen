import "@zitadel/components";

import type { Branding, ZitadelLogin } from "@zitadel/components";
import { useEffect, useRef } from "react";

import { project } from "../../api/zitadel";

export type PreviewJourney = "register" | "login" | "passkey";

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

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const login = document.createElement("zitadel-login") as ZitadelLogin;
    login.variant = "widget";
    login.purpose = journey === "register" ? "register" : "login";
    login.flowName = flowName;
    login.project = project;
    container.replaceChildren(login);
    element.current = login;
    return () => {
      login.remove();
      element.current = null;
    };
  }, [journey, flowName]);

  // Separate from the mount: an edit repaints the element that is already
  // there, rather than restarting its flow.
  useEffect(() => {
    if (!element.current) return;
    element.current.brandingOverride = draft;
    element.current.theme = theme;
  }, [draft, theme]);

  return <div ref={host} />;
}

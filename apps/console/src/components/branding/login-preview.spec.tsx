import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { apiBase } from "../../api/zitadel";
import { LoginPreview } from "./login-preview";

// The real package registers the custom element, which starts a flow on
// connect and needs a browser to paint; its behaviour is covered in
// `@zitadel/components`. Left undefined, `zitadel-login` is a plain element
// that still takes the properties this component sets on it.
vi.mock("@zitadel/components", () => ({}));

vi.mock("../../lib/project-scope", () => ({
  useRequiredProjectScope: () => "proj_selected",
}));

type Mounted = HTMLElement & {
  project?: { projectId: string; proxyPath: string; publishableKey?: string };
  purpose?: string;
  flowName?: string;
  previewState?: string;
  theme?: string;
};

function mounted(container: HTMLElement): Mounted {
  const element = container.querySelector<Mounted>("zitadel-login");
  if (!element) throw new Error("no preview element");
  return element;
}

describe("LoginPreview", () => {
  it("hands the element the selected project, without a publishable key", () => {
    const { container } = render(
      <LoginPreview journey="register" flowName="default-login" theme="revision" state="default" />,
    );

    const element = mounted(container);
    // The selected project rather than the sign-in one, and no key: the
    // console only discovers its own project's key, and the flow start takes
    // the project id alone.
    expect(element.project).toEqual({ projectId: "proj_selected", proxyPath: apiBase });
    expect(element.project?.publishableKey).toBeUndefined();
    expect(element.purpose).toBe("register");
    expect(element.flowName).toBe("default-login");
    expect(element.previewState).toBe("default");
  });

  it("switches the state on the element it already mounted", () => {
    const { container, rerender } = render(
      <LoginPreview journey="login" flowName="" theme="revision" state="default" />,
    );
    const before = mounted(container);

    act(() => {
      rerender(<LoginPreview journey="login" flowName="" theme="revision" state="loading" />);
    });

    // Same element: a state change must not restart the flow.
    expect(mounted(container)).toBe(before);
    expect(before.previewState).toBe("loading");
  });
});

import { act, render } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiBase } from "../../api/zitadel";
import { LoginPreview } from "./login-preview";

type LoginProps = {
  project?: { projectId: string; proxyPath: string; publishableKey?: string };
  variant?: string;
  purpose?: string;
  flowName?: string;
  theme?: string;
  previewState?: string;
  previewSuccessStep?: string;
  onFlowStep?: (detail: { step: unknown }) => void;
};

// What the element was last given, and how many of it were built: a remount
// is what restarts the flow.
const seen = vi.hoisted(() => ({ props: {} as LoginProps, built: 0 }));

// The real wrapper registers the custom element, which starts a flow on
// connect and needs a browser to paint; its behaviour is covered in
// `@zitadel/components` and `@zitadel/sdk-react`. This spec is about which
// props the preview hands it.
vi.mock("@zitadel/sdk-react", () => ({
  ZitadelLogin: (props: LoginProps) => {
    useState(() => (seen.built += 1));
    seen.props = props;
    return <div data-testid="login" />;
  },
}));

vi.mock("@zitadel/components", () => ({
  loginPreviewStatesFor: (step: { fields: unknown[] }) =>
    step.fields.length > 0 ? ["default", "validation_error"] : ["default"],
}));

vi.mock("../../lib/project-scope", () => ({
  useRequiredProjectScope: () => "proj_selected",
}));

beforeEach(() => {
  seen.props = {};
  seen.built = 0;
});

describe("LoginPreview", () => {
  it("hands the element the selected project, without a publishable key", () => {
    render(
      <LoginPreview journey="register" flowName="default-login" theme="revision" state="default" />,
    );

    // The selected project rather than the sign-in one, and no key: the
    // console only discovers its own project's key, and the flow start takes
    // the project id alone.
    expect(seen.props.project).toEqual({ projectId: "proj_selected", proxyPath: apiBase });
    expect(seen.props.project?.publishableKey).toBeUndefined();
    expect(seen.props.variant).toBe("widget");
    expect(seen.props.purpose).toBe("register");
    expect(seen.props.flowName).toBe("default-login");
    expect(seen.props.previewState).toBe("default");
  });

  it("switches state and theme on the element it already mounted", () => {
    const { rerender } = render(
      <LoginPreview journey="login" flowName="" theme="revision" state="default" />,
    );
    // Unset, so the revision's own mode governs.
    expect(seen.props.theme).toBeUndefined();

    act(() => {
      rerender(<LoginPreview journey="login" flowName="" theme="dark" state="loading" />);
    });

    // Same element: neither change may restart the flow.
    expect(seen.built).toBe(1);
    expect(seen.props.previewState).toBe("loading");
    expect(seen.props.theme).toBe("dark");
  });

  it("builds a new element for another journey or flow", () => {
    const { rerender } = render(
      <LoginPreview journey="login" flowName="" theme="revision" state="default" />,
    );

    act(() => {
      rerender(<LoginPreview journey="register" flowName="" theme="revision" state="default" />);
    });
    expect(seen.built).toBe(2);

    act(() => {
      rerender(
        <LoginPreview journey="register" flowName="onboarding" theme="revision" state="default" />,
      );
    });
    expect(seen.built).toBe(3);
  });

  it("names the flow's terminal step for the success state", () => {
    render(
      <LoginPreview
        journey="login"
        flowName="onboarding"
        theme="revision"
        state="success"
        successStep="welcome"
      />,
    );

    expect(seen.props.previewSuccessStep).toBe("welcome");
  });

  it("reports which states the served step can show", () => {
    const onStates = vi.fn();
    render(
      <LoginPreview
        journey="login"
        flowName=""
        theme="revision"
        state="default"
        onStates={onStates}
      />,
    );

    act(() => seen.props.onFlowStep?.({ step: { fields: [] } }));

    expect(onStates).toHaveBeenCalledWith(["default"]);
  });
});

import { renderToString } from "@qwik.dev/core/server";
import { describe, expect, it } from "vitest";

import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

const project = {
  projectId: "proj-test",
  proxyPath: "/__nextgen",
  url: "http://auth.test",
  publishableKey: "pk_test_123",
};

/**
 * Renders on the server, as Qwik Router does, and returns the attributes of the
 * first `<tag>` in the HTML. This is what the browser parses before any client
 * binder runs, so the widget must be fully configured by these alone.
 */
async function serverAttributes(
  tag: string,
  jsx: Parameters<typeof renderToString>[0],
): Promise<Record<string, string>> {
  const { html } = await renderToString(jsx, { containerTagName: "div" });
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`).exec(html);
  expect(open, `<${tag}> missing from server HTML`).not.toBeNull();
  return Object.fromEntries(
    [...(open?.[1] ?? "").matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? ""]),
  );
}

describe("server-rendered widget config", () => {
  it("emits the login config in the server HTML", async () => {
    const attrs = await serverAttributes(
      "zitadel-login",
      <ZitadelLogin
        project={project}
        purpose="register"
        postSignInUrl="/profile"
        flowName="signup"
        suppressHeader
        suppressPasswordToggle
        resumeFlowId="flow_123"
        variant="page"
        theme="dark"
        lang="de"
      />,
    );

    expect(attrs).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      url: "http://auth.test",
      "publishable-key": "pk_test_123",
      purpose: "register",
      "post-sign-in-url": "/profile",
      "flow-name": "signup",
      "suppress-header": "",
      "suppress-password-toggle": "",
      "resume-flow-id": "flow_123",
      variant: "page",
      theme: "dark",
      lang: "de",
    });
  });

  it("serializes an explicit empty proxy path as the root", async () => {
    const withHandle = await serverAttributes(
      "zitadel-login",
      <ZitadelLogin project={{ projectId: "proj-test", proxyPath: "" }} />,
    );
    const discrete = await serverAttributes(
      "zitadel-login",
      <ZitadelLogin projectId="proj-test" proxyPath="" />,
    );

    expect(withHandle).toMatchObject({ "proxy-path": "/" });
    expect(discrete).toMatchObject({ "proxy-path": "/" });
  });

  it("omits the resume handle and the flags when they are unset", async () => {
    const attrs = await serverAttributes("zitadel-login", <ZitadelLogin project={project} />);

    expect(attrs).not.toHaveProperty("resume-flow-id");
    expect(attrs).not.toHaveProperty("suppress-header");
    expect(attrs).not.toHaveProperty("suppress-password-toggle");
  });

  it("omits a null resume handle", async () => {
    const attrs = await serverAttributes(
      "zitadel-login",
      <ZitadelLogin project={project} resumeFlowId={null} />,
    );

    expect(attrs).not.toHaveProperty("resume-flow-id");
  });

  it("emits the logout config in the server HTML", async () => {
    const attrs = await serverAttributes(
      "zitadel-logout",
      <ZitadelLogout project={project} postSignOutUrl="/login" theme="dark" />,
    );

    expect(attrs).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "publishable-key": "pk_test_123",
      "post-sign-out-url": "/login",
      theme: "dark",
    });
  });

  it("emits the session config in the server HTML", async () => {
    const attrs = await serverAttributes(
      "zitadel-session",
      <ZitadelSession
        project={project}
        postSignOutUrl="/login"
        heading="Hi"
        logoutLabel="Leave"
        variant="page"
        theme="light"
        suppressHeader
      />,
    );

    expect(attrs).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "publishable-key": "pk_test_123",
      "post-sign-out-url": "/login",
      heading: "Hi",
      "logout-label": "Leave",
      variant: "page",
      theme: "light",
      "suppress-header": "",
    });
  });

  it("leaves heading and logoutLabel to the widget's own defaults when unset", async () => {
    const attrs = await serverAttributes("zitadel-session", <ZitadelSession project={project} />);

    expect(attrs).not.toHaveProperty("heading");
    expect(attrs).not.toHaveProperty("logout-label");
  });

  it("emits the discrete project id and proxy path", async () => {
    const attrs = await serverAttributes(
      "zitadel-login",
      <ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />,
    );

    expect(attrs).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      purpose: "login",
    });
  });
});

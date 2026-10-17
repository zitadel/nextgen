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
    });
  });

  it("emits the logout config in the server HTML", async () => {
    const attrs = await serverAttributes(
      "zitadel-logout",
      <ZitadelLogout project={project} postSignOutUrl="/login" />,
    );

    expect(attrs).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "publishable-key": "pk_test_123",
      "post-sign-out-url": "/login",
    });
  });

  it("emits the session config in the server HTML", async () => {
    const attrs = await serverAttributes(
      "zitadel-session",
      <ZitadelSession project={project} postSignOutUrl="/login" heading="Hi" logoutLabel="Leave" />,
    );

    expect(attrs).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "publishable-key": "pk_test_123",
      "post-sign-out-url": "/login",
      heading: "Hi",
      "logout-label": "Leave",
    });
  });

  it("emits the session card defaults when heading and logoutLabel are unset", async () => {
    const attrs = await serverAttributes("zitadel-session", <ZitadelSession project={project} />);

    expect(attrs).toMatchObject({ heading: "Signed in as", "logout-label": "Sign out" });
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

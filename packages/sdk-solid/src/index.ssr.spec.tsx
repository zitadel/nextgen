import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

/** The attributes of the first `<tag>` in server-rendered HTML. */
function serverAttributes(tag: string, html: string): Record<string, string> {
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`).exec(html);
  expect(open, `<${tag}> missing from server HTML`).not.toBeNull();
  return Object.fromEntries(
    [...(open?.[1] ?? "").matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? ""]),
  );
}

describe("server-rendered widget config", () => {
  it("puts the login flow config into the server markup", () => {
    const html = renderToString(() => (
      <ZitadelLogin
        projectId="proj-test"
        proxyPath="/__nextgen"
        purpose="register"
        flowName="signup"
        resumeFlowId="flow_123"
      />
    ));
    expect(serverAttributes("zitadel-login", html)).toMatchObject({
      purpose: "register",
      "flow-name": "signup",
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "resume-flow-id": "flow_123",
    });
  });

  it("puts the session config into the server markup", () => {
    const html = renderToString(() => (
      <ZitadelSession
        projectId="proj-test"
        proxyPath="/__nextgen"
        postSignOutUrl="/bye"
        heading="Hi"
      />
    ));
    expect(serverAttributes("zitadel-session", html)).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "post-sign-out-url": "/bye",
      heading: "Hi",
    });
  });

  it("puts the logout config into the server markup", () => {
    const html = renderToString(() => (
      <ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" postSignOutUrl="/bye" />
    ));
    expect(serverAttributes("zitadel-logout", html)).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "post-sign-out-url": "/bye",
    });
  });

  it("leaves unset props out of the markup", () => {
    const html = renderToString(() => <ZitadelSession projectId="proj-test" />);
    expect(html).not.toContain("heading=");
  });
});

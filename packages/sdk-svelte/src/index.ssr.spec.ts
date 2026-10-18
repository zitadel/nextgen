import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import ZitadelLogin from "./lib/ZitadelLogin.svelte";
import ZitadelLogout from "./lib/ZitadelLogout.svelte";
import ZitadelSession from "./lib/ZitadelSession.svelte";

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
    const { body } = render(ZitadelLogin, {
      props: {
        projectId: "proj-test",
        proxyPath: "/__nextgen",
        purpose: "register",
        flowName: "signup",
        resumeFlowId: "flow_123",
        postSignInUrl: "/home",
      },
    });
    expect(serverAttributes("zitadel-login", body)).toMatchObject({
      purpose: "register",
      "flow-name": "signup",
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "resume-flow-id": "flow_123",
      "post-sign-in-url": "/home",
    });
  });

  it("puts the session config into the server markup", () => {
    const { body } = render(ZitadelSession, {
      props: { projectId: "proj-test", proxyPath: "/__nextgen", postSignOutUrl: "/bye" },
    });
    expect(serverAttributes("zitadel-session", body)).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "post-sign-out-url": "/bye",
    });
  });

  it("puts the logout config into the server markup", () => {
    const { body } = render(ZitadelLogout, {
      props: { projectId: "proj-test", proxyPath: "/__nextgen", postSignOutUrl: "/bye" },
    });
    expect(serverAttributes("zitadel-logout", body)).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      "post-sign-out-url": "/bye",
    });
  });
});

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
  const handle = { projectId: "proj-test", proxyPath: "/__nextgen", url: "http://auth.test" };

  it("puts the login flow config into the server markup", () => {
    expect(
      serverAttributes(
        "zitadel-login",
        renderToString(() => (
          <ZitadelLogin project={handle} purpose="register" flowName="signup" />
        )),
      ),
    ).toMatchObject({
      purpose: "register",
      "flow-name": "signup",
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      url: "http://auth.test",
    });
  });

  it("puts the discrete project props into the login markup", () => {
    expect(
      serverAttributes(
        "zitadel-login",
        renderToString(() => <ZitadelLogin projectId="p1" proxyPath="/px" />),
      ),
    ).toMatchObject({ purpose: "login", "project-id": "p1", "proxy-path": "/px" });
  });

  it("puts the session config into the server markup", () => {
    expect(
      serverAttributes(
        "zitadel-session",
        renderToString(() => <ZitadelSession project={handle} postSignOutUrl="/bye" />),
      ),
    ).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      url: "http://auth.test",
      "post-sign-out-url": "/bye",
    });
  });

  it("puts the logout config into the server markup", () => {
    expect(
      serverAttributes(
        "zitadel-logout",
        renderToString(() => <ZitadelLogout project={handle} postSignOutUrl="/bye" />),
      ),
    ).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      url: "http://auth.test",
      "post-sign-out-url": "/bye",
    });
  });

  it.each([
    ["zitadel-login", (p: object) => <ZitadelLogin {...p} />],
    ["zitadel-session", (p: object) => <ZitadelSession {...p} />],
    ["zitadel-logout", (p: object) => <ZitadelLogout {...p} />],
  ])("lets the project handle win over discrete props in %s", (tag, widget) => {
    expect(
      serverAttributes(
        tag,
        renderToString(() => widget({ project: handle, projectId: "other", proxyPath: "/other" })),
      ),
    ).toMatchObject({ "project-id": "proj-test", "proxy-path": "/__nextgen" });
  });

  it.each([
    ["zitadel-login", (p: object) => <ZitadelLogin {...p} />],
    ["zitadel-session", (p: object) => <ZitadelSession {...p} />],
    ["zitadel-logout", (p: object) => <ZitadelLogout {...p} />],
  ])("writes an empty proxy path as / in %s", (tag, widget) => {
    expect(
      serverAttributes(
        tag,
        renderToString(() => widget({ project: { projectId: "p", proxyPath: "" } })),
      ),
    ).toMatchObject({ "proxy-path": "/" });
  });
});

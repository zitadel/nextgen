import { renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";

import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";
import { type WidgetName, widgetNames, widgetTags } from "@zitadel/sdk-core/types";

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
        widgetTags.login,
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
        widgetTags.login,
        renderToString(() => <ZitadelLogin projectId="p1" proxyPath="/px" />),
      ),
    ).toMatchObject({ purpose: "login", "project-id": "p1", "proxy-path": "/px" });
  });

  it("puts the session config into the server markup", () => {
    expect(
      serverAttributes(
        widgetTags.session,
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
        widgetTags.logout,
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
    [widgetTags.login, (p: object) => <ZitadelLogin {...p} />],
    [widgetTags.session, (p: object) => <ZitadelSession {...p} />],
    [widgetTags.logout, (p: object) => <ZitadelLogout {...p} />],
  ])("lets the project handle win over discrete props in %s", (tag, widget) => {
    expect(
      serverAttributes(
        tag,
        renderToString(() => widget({ project: handle, projectId: "other", proxyPath: "/other" })),
      ),
    ).toMatchObject({ "project-id": "proj-test", "proxy-path": "/__nextgen" });
  });

  it.each([
    [widgetTags.login, (p: object) => <ZitadelLogin {...p} />],
    [widgetTags.session, (p: object) => <ZitadelSession {...p} />],
    [widgetTags.logout, (p: object) => <ZitadelLogout {...p} />],
  ])("writes an empty proxy path as / in %s", (tag, widget) => {
    expect(
      serverAttributes(
        tag,
        renderToString(() => widget({ project: { projectId: "p", proxyPath: "" } })),
      ),
    ).toMatchObject({ "proxy-path": "/" });
  });
});

describe("server-rendered widget options", () => {
  it("puts the resume flow id into the login markup", () => {
    expect(
      serverAttributes(
        widgetTags.login,
        renderToString(() => <ZitadelLogin projectId="proj-test" resumeFlowId="flow_123" />),
      ),
    ).toMatchObject({ "resume-flow-id": "flow_123" });
  });

  it("puts the session heading into the server markup", () => {
    expect(
      serverAttributes(
        widgetTags.session,
        renderToString(() => <ZitadelSession projectId="proj-test" heading="Hi" />),
      ),
    ).toMatchObject({ heading: "Hi" });
  });

  it("leaves unset props out of the markup", () => {
    const html = renderToString(() => <ZitadelSession projectId="proj-test" />);
    expect(html).not.toContain("heading=");
  });
});

/** The attributes on the widget's element in the markup a server would send. */
async function renderAttributes(
  widget: WidgetName,
  props: Readonly<Record<string, unknown>>,
): Promise<Record<string, string>> {
  const Widget = { login: ZitadelLogin, logout: ZitadelLogout, session: ZitadelSession }[widget];
  return serverAttributes(
    widgetTags[widget],
    renderToString(() => <Widget {...props} />),
  );
}

// standard-attributes-server:begin
describe.each(widgetNames)("%s server-rendered standard attributes", (widget) => {
  it("puts the standard attributes into the server markup", async () => {
    const attributes = await renderAttributes(widget, {
      id: "probe",
      title: "probe",
      slot: "probe",
      role: "region",
      tabindex: "3",
      "data-testid": "probe",
      "aria-label": "probe",
    });
    expect(attributes).toMatchObject({
      id: "probe",
      title: "probe",
      slot: "probe",
      role: "region",
      tabindex: "3",
      "data-testid": "probe",
      "aria-label": "probe",
    });
  });

  it("leaves props outside the standard set out of the server markup", async () => {
    const attributes = await renderAttributes(widget, {
      srcdoc: "probe",
      onclick: "probe",
      part: "probe",
      dir: "probe",
    });
    for (const name of ["srcdoc", "onclick", "part", "dir"]) {
      expect(attributes).not.toHaveProperty(name);
    }
  });
});
// standard-attributes-server:end

describe("the built package on a Node server", () => {
  it.each(widgetNames)("renders the %s widget from the shipped entry", async (widget) => {
    const sdk = await import("@zitadel/sdk-solid");
    const Widget = {
      login: sdk.ZitadelLogin,
      logout: sdk.ZitadelLogout,
      session: sdk.ZitadelSession,
    }[widget];
    expect(
      serverAttributes(
        widgetTags[widget],
        renderToString(() => <Widget projectId="p1" proxyPath="/px" />),
      ),
    ).toMatchObject({ "project-id": "p1", "proxy-path": "/px" });
  });
});

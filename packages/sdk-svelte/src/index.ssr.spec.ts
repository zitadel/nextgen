// @vitest-environment node
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import ZitadelLogin from "./lib/ZitadelLogin.svelte";
import ZitadelLogout from "./lib/ZitadelLogout.svelte";
import ZitadelSession from "./lib/ZitadelSession.svelte";
import { widgetTags } from "@zitadel/sdk-core/types";

/** The attributes of the first `<tag>` in server-rendered HTML. */
function serverAttributes(
  tag: string,
  component: typeof ZitadelLogin | typeof ZitadelLogout | typeof ZitadelSession,
  props: Record<string, unknown>,
): Record<string, string> {
  const { body } = render(component as typeof ZitadelLogin, { props });
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`).exec(body);
  expect(open, `<${tag}> missing from server HTML`).not.toBeNull();
  return Object.fromEntries(
    [...(open?.[1] ?? "").matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/g)].map((m) => [m[1], m[2] ?? ""]),
  );
}

describe("server-rendered widget config", () => {
  const handle = { projectId: "proj-test", proxyPath: "/__nextgen", url: "http://auth.test" };

  it("puts the login flow config into the server markup", () => {
    expect(
      serverAttributes(widgetTags.login, ZitadelLogin, {
        project: handle,
        purpose: "register",
        flowName: "signup",
      }),
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
      serverAttributes(widgetTags.login, ZitadelLogin, { projectId: "p1", proxyPath: "/px" }),
    ).toMatchObject({ purpose: "login", "project-id": "p1", "proxy-path": "/px" });
  });

  it("puts the session config into the server markup", () => {
    expect(
      serverAttributes(widgetTags.session, ZitadelSession, {
        project: handle,
        postSignOutUrl: "/bye",
      }),
    ).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      url: "http://auth.test",
      "post-sign-out-url": "/bye",
    });
  });

  it("puts the logout config into the server markup", () => {
    expect(
      serverAttributes(widgetTags.logout, ZitadelLogout, {
        project: handle,
        postSignOutUrl: "/bye",
      }),
    ).toMatchObject({
      "project-id": "proj-test",
      "proxy-path": "/__nextgen",
      url: "http://auth.test",
      "post-sign-out-url": "/bye",
    });
  });

  it.each([
    [widgetTags.login, ZitadelLogin],
    [widgetTags.session, ZitadelSession],
    [widgetTags.logout, ZitadelLogout],
  ])("lets the project handle win over discrete props in %s", (tag, component) => {
    expect(
      serverAttributes(tag, component, {
        project: handle,
        projectId: "other",
        proxyPath: "/other",
      }),
    ).toMatchObject({ "project-id": "proj-test", "proxy-path": "/__nextgen" });
  });

  it.each([
    [widgetTags.login, ZitadelLogin],
    [widgetTags.session, ZitadelSession],
    [widgetTags.logout, ZitadelLogout],
  ])("writes an empty proxy path as / in %s", (tag, component) => {
    expect(
      serverAttributes(tag, component, { project: { projectId: "p", proxyPath: "" } }),
    ).toMatchObject({ "proxy-path": "/" });
  });

  it.each([
    [widgetTags.login, ZitadelLogin],
    [widgetTags.session, ZitadelSession],
    [widgetTags.logout, ZitadelLogout],
  ])("does not stringify the project handle into %s", (tag, component) => {
    expect(serverAttributes(tag, component, { project: handle })).not.toHaveProperty("project");
  });
});

describe("server-rendered widget options", () => {
  it("puts the resume flow id and post-sign-in URL into the login markup", () => {
    expect(
      serverAttributes(widgetTags.login, ZitadelLogin, {
        projectId: "proj-test",
        resumeFlowId: "flow_123",
        postSignInUrl: "/home",
      }),
    ).toMatchObject({ "resume-flow-id": "flow_123", "post-sign-in-url": "/home" });
  });

  it("leaves unset props out of the session markup", () => {
    expect(
      serverAttributes(widgetTags.session, ZitadelSession, { projectId: "proj-test" }),
    ).not.toHaveProperty("heading");
  });
});

// @vitest-environment node
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";

import type * as Sdk from "./lib/index";

// Resolved through the package's own `exports` map (the `svelte` condition,
// which serves uncompiled components), not the `.svelte` sources, so the spec
// covers what a SvelteKit app imports.
const sdk = "@zitadel/sdk-svelte";
const { ZitadelLogin, ZitadelLogout, ZitadelSession } = (await import(sdk)) as typeof Sdk;

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
      serverAttributes("zitadel-login", ZitadelLogin, {
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
      serverAttributes("zitadel-login", ZitadelLogin, { projectId: "p1", proxyPath: "/px" }),
    ).toMatchObject({ purpose: "login", "project-id": "p1", "proxy-path": "/px" });
  });

  it("puts the display options into the server markup", () => {
    expect(
      serverAttributes("zitadel-login", ZitadelLogin, {
        project: handle,
        variant: "page",
        theme: "dark",
        lang: "de",
        suppressHeader: true,
      }),
    ).toMatchObject({ variant: "page", theme: "dark", lang: "de", "suppress-header": "" });
  });

  it.each([
    ["zitadel-login", ZitadelLogin],
    ["zitadel-session", ZitadelSession],
    ["zitadel-logout", ZitadelLogout],
  ])("leaves a keyed project handle out of %s", (tag, component) => {
    const attributes = serverAttributes(tag, component, {
      project: { ...handle, publishableKey: "pk_test_123" },
      projectId: "other",
    });
    expect(attributes).not.toHaveProperty("project-id");
    expect(attributes).not.toHaveProperty("proxy-path");
    expect(attributes).not.toHaveProperty("url");
  });

  it("puts the session config into the server markup", () => {
    expect(
      serverAttributes("zitadel-session", ZitadelSession, {
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
      serverAttributes("zitadel-logout", ZitadelLogout, {
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
    ["zitadel-login", ZitadelLogin],
    ["zitadel-session", ZitadelSession],
    ["zitadel-logout", ZitadelLogout],
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
    ["zitadel-login", ZitadelLogin],
    ["zitadel-session", ZitadelSession],
    ["zitadel-logout", ZitadelLogout],
  ])("writes an empty proxy path as / in %s", (tag, component) => {
    expect(
      serverAttributes(tag, component, { project: { projectId: "p", proxyPath: "" } }),
    ).toMatchObject({ "proxy-path": "/" });
  });

  it.each([
    ["zitadel-login", ZitadelLogin],
    ["zitadel-session", ZitadelSession],
    ["zitadel-logout", ZitadelLogout],
  ])("does not stringify the project handle into %s", (tag, component) => {
    expect(serverAttributes(tag, component, { project: handle })).not.toHaveProperty("project");
  });
});

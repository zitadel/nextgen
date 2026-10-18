import { describe, expect, it } from "vitest";

import { widgetAttributes } from "./attributes.js";

const handle = { projectId: "proj-h", proxyPath: "/h", url: "http://auth.test" };

describe("widgetAttributes", () => {
  it.each([
    [
      "login",
      {
        projectId: "p1",
        proxyPath: "/px",
        variant: "page",
        theme: "dark",
        suppressHeader: true,
        suppressPasswordToggle: true,
        purpose: "register",
        flowName: "signup",
        postSignInUrl: "/home",
        resumeFlowId: "flow-1",
        lang: "de",
      },
      {
        "project-id": "p1",
        "proxy-path": "/px",
        variant: "page",
        theme: "dark",
        "suppress-header": "",
        "suppress-password-toggle": "",
        purpose: "register",
        "flow-name": "signup",
        "post-sign-in-url": "/home",
        "resume-flow-id": "flow-1",
        lang: "de",
      },
    ],
    [
      "session",
      {
        projectId: "p1",
        postSignOutUrl: "/bye",
        heading: "Hi",
        logoutLabel: "Out",
        variant: "page",
        theme: "light",
        suppressHeader: true,
      },
      {
        "project-id": "p1",
        "post-sign-out-url": "/bye",
        heading: "Hi",
        "logout-label": "Out",
        variant: "page",
        theme: "light",
        "suppress-header": "",
      },
    ],
    [
      "logout",
      { projectId: "p1", postSignOutUrl: "/bye", theme: "auto" },
      { "project-id": "p1", "post-sign-out-url": "/bye", theme: "auto" },
    ],
  ] as const)("writes every %s option as a kebab-case attribute", (widget, config, expected) => {
    expect(widgetAttributes(widget, config as never)).toEqual(expected);
  });

  it.each(["login", "session", "logout"] as const)("writes nothing for an empty %s", (widget) => {
    expect(widgetAttributes(widget, {})).toEqual({});
  });

  it.each(["login", "session", "logout"] as const)(
    "lets the project handle win over the discrete props of %s",
    (widget) => {
      expect(
        widgetAttributes(widget, { project: handle, projectId: "other", proxyPath: "/other" }),
      ).toEqual({ "project-id": "proj-h", "proxy-path": "/h", url: "http://auth.test" });
    },
  );

  it.each([
    ["the discrete prop", { proxyPath: "" }],
    ["the handle", { project: { projectId: "p", proxyPath: "" }, proxyPath: "/other" }],
  ])("writes an empty proxy path of %s as the root", (_, config) => {
    expect(widgetAttributes("session", config)["proxy-path"]).toBe("/");
  });

  it.each(["login", "session", "logout"] as const)(
    "writes no project attribute for a %s handle with a publishable key",
    (widget) => {
      expect(
        widgetAttributes(widget, {
          project: { ...handle, publishableKey: "pk_test_1" },
          projectId: "other",
          proxyPath: "/other",
          theme: "dark",
        }),
      ).toEqual({ theme: "dark" });
    },
  );

  it("writes a boolean as present or absent", () => {
    expect(widgetAttributes("login", { suppressHeader: true })).toEqual({ "suppress-header": "" });
    expect(widgetAttributes("login", { suppressHeader: false })).toEqual({});
  });

  it("leaves out unset, null and empty values", () => {
    expect(
      widgetAttributes("login", {
        flowName: "",
        resumeFlowId: null,
        lang: undefined,
        postSignInUrl: "",
      }),
    ).toEqual({});
  });
});

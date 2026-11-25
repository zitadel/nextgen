import { type WidgetName, widgetNames } from "@zitadel/sdk-core/types";

import { describe, expect, it } from "vitest";

/** The SDKs that write widget attributes into markup, as the table's `gaps` name them. */
export type Sdk = "react" | "vue" | "angular" | "svelte" | "solid" | "qwik";

/** The attributes on the widget's element in the markup a server would send. */
export type RenderAttributes = (
  widget: WidgetName,
  props: Readonly<Record<string, unknown>>,
) => Promise<Record<string, string>>;

type ServerRenderCase = {
  readonly title: string;
  readonly widget: "login" | "session" | "logout";
  readonly props: Readonly<Record<string, unknown>>;
  readonly present: Readonly<Record<string, string>>;
  readonly absent: readonly string[];
  /** SDKs whose markup does not do this yet: not covered, so the row is not run there. */
  readonly gaps?: readonly Sdk[];
};

const SERVER_RENDER_HANDLE = {
  projectId: "proj-handle",
  proxyPath: "/__handle",
  url: "https://auth.example.com",
};

const SERVER_RENDER_CASES: readonly ServerRenderCase[] = [
  {
    title: "puts the discrete project props into the login markup",
    widget: "login",
    props: { projectId: "p1", proxyPath: "/px" },
    present: { "project-id": "p1", "proxy-path": "/px" },
    absent: ["url"],
  },
  {
    title: "puts the project handle into the login markup",
    widget: "login",
    props: { project: SERVER_RENDER_HANDLE },
    present: {
      "project-id": "proj-handle",
      "proxy-path": "/__handle",
      url: "https://auth.example.com",
    },
    absent: ["publishable-key"],
  },
  {
    title: "lets the project handle win over conflicting discrete props in the login markup",
    widget: "login",
    props: { project: SERVER_RENDER_HANDLE, projectId: "proj-other", proxyPath: "/__other" },
    present: { "project-id": "proj-handle", "proxy-path": "/__handle" },
    absent: [],
  },
  {
    title: "writes nothing for no config in the login markup",
    widget: "login",
    props: {},
    present: {},
    absent: ["project-id", "proxy-path", "url", "flow-name", "resume-flow-id", "post-sign-in-url"],
  },
  {
    title: "puts the purpose into the login markup",
    widget: "login",
    props: { projectId: "p1", purpose: "register" },
    present: { purpose: "register" },
    absent: [],
  },
  {
    title: "puts the default purpose into the login markup",
    widget: "login",
    props: { projectId: "p1" },
    present: { purpose: "login" },
    absent: [],
  },
  {
    title: "puts the flow name into the login markup",
    widget: "login",
    props: { projectId: "p1", flowName: "signup" },
    present: { "flow-name": "signup" },
    absent: [],
  },
  {
    title: "puts the resume flow id into the login markup",
    widget: "login",
    props: { projectId: "p1", resumeFlowId: "flow_123" },
    present: { "resume-flow-id": "flow_123" },
    absent: [],
  },
  {
    title: "leaves an unset resume flow id out of the login markup",
    widget: "login",
    props: { projectId: "p1" },
    present: {},
    absent: ["resume-flow-id"],
  },
  {
    title: "leaves an empty resume flow id out of the login markup",
    widget: "login",
    props: { projectId: "p1", resumeFlowId: "" },
    present: {},
    absent: ["resume-flow-id"],
  },
  {
    title: "puts the post-sign-in URL into the login markup",
    widget: "login",
    props: { projectId: "p1", postSignInUrl: "/home" },
    present: { "post-sign-in-url": "/home" },
    absent: [],
  },
  {
    title: "leaves an unset post-sign-in URL out of the login markup",
    widget: "login",
    props: { projectId: "p1" },
    present: {},
    absent: ["post-sign-in-url"],
  },
  {
    title: "puts the variant into the login markup",
    widget: "login",
    props: { projectId: "p1", variant: "page" },
    present: { variant: "page" },
    absent: [],
  },
  {
    title: "puts the theme into the login markup",
    widget: "login",
    props: { projectId: "p1", theme: "dark" },
    present: { theme: "dark" },
    absent: [],
  },
  {
    title: "puts the language into the login markup",
    widget: "login",
    props: { projectId: "p1", lang: "de" },
    present: { lang: "de" },
    absent: [],
  },
  {
    title: "leaves unset display options out of the login markup",
    widget: "login",
    props: { projectId: "p1" },
    present: {},
    absent: [
      "variant",
      "theme",
      "suppress-header",
      "suppress-password-toggle",
      "force-post-sign-in-url",
    ],
  },
  {
    title: "leaves a false boolean option out of the login markup",
    widget: "login",
    props: {
      projectId: "p1",
      suppressHeader: false,
      suppressPasswordToggle: false,
      forcePostSignInUrl: false,
    },
    present: {},
    absent: ["suppress-header", "suppress-password-toggle", "force-post-sign-in-url"],
  },
  {
    title: "puts the discrete project props into the session markup",
    widget: "session",
    props: { projectId: "p1", proxyPath: "/px" },
    present: { "project-id": "p1", "proxy-path": "/px" },
    absent: ["url"],
  },
  {
    title: "puts the project handle into the session markup",
    widget: "session",
    props: { project: SERVER_RENDER_HANDLE },
    present: {
      "project-id": "proj-handle",
      "proxy-path": "/__handle",
      url: "https://auth.example.com",
    },
    absent: ["publishable-key"],
  },
  {
    title: "lets the project handle win over conflicting discrete props in the session markup",
    widget: "session",
    props: { project: SERVER_RENDER_HANDLE, projectId: "proj-other", proxyPath: "/__other" },
    present: { "project-id": "proj-handle", "proxy-path": "/__handle" },
    absent: [],
  },
  {
    title: "writes nothing for no config in the session markup",
    widget: "session",
    props: {},
    present: {},
    absent: ["project-id", "proxy-path", "url", "post-sign-out-url"],
  },
  {
    title: "puts the post-sign-out URL into the session markup",
    widget: "session",
    props: { projectId: "p1", postSignOutUrl: "/bye" },
    present: { "post-sign-out-url": "/bye" },
    absent: [],
  },
  {
    title: "puts a keyed project handle into the login markup",
    widget: "login",
    props: {
      project: { ...SERVER_RENDER_HANDLE, publishableKey: "pk_test_123" },
      projectId: "proj-other",
    },
    present: {
      "project-id": "proj-handle",
      "proxy-path": "/__handle",
      url: "https://auth.example.com",
      "publishable-key": "pk_test_123",
    },
    absent: [],
  },
  {
    title: "puts a keyed project handle into the session markup",
    widget: "session",
    props: {
      project: { ...SERVER_RENDER_HANDLE, publishableKey: "pk_test_123" },
      projectId: "proj-other",
    },
    present: {
      "project-id": "proj-handle",
      "proxy-path": "/__handle",
      url: "https://auth.example.com",
      "publishable-key": "pk_test_123",
    },
    absent: [],
  },
  {
    title: "puts a keyed project handle into the logout markup",
    widget: "logout",
    props: {
      project: { ...SERVER_RENDER_HANDLE, publishableKey: "pk_test_123" },
      projectId: "proj-other",
    },
    present: {
      "project-id": "proj-handle",
      "proxy-path": "/__handle",
      url: "https://auth.example.com",
      "publishable-key": "pk_test_123",
    },
    absent: [],
  },
  {
    title: "puts the discrete project props into the logout markup",
    widget: "logout",
    props: { projectId: "p1", proxyPath: "/px" },
    present: { "project-id": "p1", "proxy-path": "/px" },
    absent: ["url"],
  },
  {
    title: "puts the project handle into the logout markup",
    widget: "logout",
    props: { project: SERVER_RENDER_HANDLE },
    present: {
      "project-id": "proj-handle",
      "proxy-path": "/__handle",
      url: "https://auth.example.com",
    },
    absent: ["publishable-key"],
  },
  {
    title: "lets the project handle win over conflicting discrete props in the logout markup",
    widget: "logout",
    props: { project: SERVER_RENDER_HANDLE, projectId: "proj-other", proxyPath: "/__other" },
    present: { "project-id": "proj-handle", "proxy-path": "/__handle" },
    absent: [],
  },
  {
    title: "writes nothing for no config in the logout markup",
    widget: "logout",
    props: {},
    present: {},
    absent: ["project-id", "proxy-path", "url", "post-sign-out-url"],
  },
  {
    title: "puts the post-sign-out URL into the logout markup",
    widget: "logout",
    props: { projectId: "p1", postSignOutUrl: "/bye" },
    present: { "post-sign-out-url": "/bye" },
    absent: [],
  },
  {
    title: "normalizes an empty proxy path to the site root in the login markup",
    widget: "login",
    props: { projectId: "p1", proxyPath: "" },
    present: { "proxy-path": "/" },
    absent: [],
  },
  {
    title: "normalizes an empty proxy path to the site root in the session markup",
    widget: "session",
    props: { projectId: "p1", proxyPath: "" },
    present: { "proxy-path": "/" },
    absent: [],
  },
  {
    title: "normalizes an empty proxy path to the site root in the logout markup",
    widget: "logout",
    props: { projectId: "p1", proxyPath: "" },
    present: { "proxy-path": "/" },
    absent: [],
  },
  {
    title: "puts the heading into the session markup",
    widget: "session",
    props: { projectId: "p1", heading: "Welcome" },
    present: { heading: "Welcome" },
    absent: [],
  },
  {
    title: "puts the logout label into the session markup",
    widget: "session",
    props: { projectId: "p1", logoutLabel: "Leave" },
    present: { "logout-label": "Leave" },
    absent: [],
  },
  {
    title: "leaves an unset heading and logout label out of the session markup",
    widget: "session",
    props: { projectId: "p1" },
    present: {},
    absent: ["heading", "logout-label"],
  },
  {
    title: "puts the theme into the logout markup",
    widget: "logout",
    props: { projectId: "p1", theme: "dark" },
    present: { theme: "dark" },
    absent: [],
  },
  {
    title: "puts the theme into the session markup",
    widget: "session",
    props: { projectId: "p1", theme: "dark" },
    present: { theme: "dark" },
    absent: [],
  },
  {
    title: "puts the variant into the session markup",
    widget: "session",
    props: { projectId: "p1", variant: "page" },
    present: { variant: "page" },
    absent: [],
  },
  {
    title: "leaves an unset theme out of the logout markup",
    widget: "logout",
    props: { projectId: "p1" },
    present: {},
    absent: ["theme"],
  },
  {
    title: "leaves an unset theme and variant out of the session markup",
    widget: "session",
    props: { projectId: "p1" },
    present: {},
    absent: ["theme", "variant", "suppress-header"],
  },
  {
    title: "puts a true boolean option into the login markup",
    widget: "login",
    props: {
      projectId: "p1",
      suppressHeader: true,
      suppressPasswordToggle: true,
      forcePostSignInUrl: true,
    },
    present: {
      "suppress-header": "",
      "suppress-password-toggle": "",
      "force-post-sign-in-url": "",
    },
    absent: [],
  },
  {
    title: "puts a true suppress-header option into the session markup",
    widget: "session",
    props: { projectId: "p1", suppressHeader: true },
    present: { "suppress-header": "" },
    absent: [],
  },
  {
    title: "leaves a false suppress-header option out of the session markup",
    widget: "session",
    props: { projectId: "p1", suppressHeader: false },
    present: {},
    absent: ["suppress-header"],
  },
  {
    title: "leaves a null resume flow id out of the login markup",
    widget: "login",
    props: { projectId: "p1", resumeFlowId: null },
    present: {},
    absent: ["resume-flow-id"],
  },
  {
    title: "leaves an empty post-sign-in URL out of the login markup",
    widget: "login",
    props: { projectId: "p1", postSignInUrl: "" },
    present: {},
    absent: ["post-sign-in-url"],
  },
  {
    title: "leaves an empty post-sign-out URL out of the session markup",
    widget: "session",
    props: { projectId: "p1", postSignOutUrl: "" },
    present: {},
    absent: ["post-sign-out-url"],
  },
  {
    title: "leaves an empty post-sign-out URL out of the logout markup",
    widget: "logout",
    props: { projectId: "p1", postSignOutUrl: "" },
    present: {},
    absent: ["post-sign-out-url"],
  },
];

/**
 * Renders every row of the table but the ones whose `gaps` name `sdk`, and
 * checks the attributes on the widget's element.
 */
export function describeServerRenderCases(sdk: Sdk, renderAttributes: RenderAttributes): void {
  describe("server-rendered widget config", () => {
    const covered = SERVER_RENDER_CASES.filter((c) => !c.gaps?.includes(sdk));

    // `%s` with the title as its own argument: Vitest cuts a `$title` to 40
    // characters, which hides which row failed.
    it.each(covered.map((c) => [c.title, c] as const))(
      "%s",
      async (_title, { widget, props, present, absent }) => {
        const attributes = await renderAttributes(widget, props);
        expect(attributes).toMatchObject(present);
        for (const name of absent) {
          expect(attributes).not.toHaveProperty(name);
        }
      },
    );
  });
}

/** Checks that the server markup carries the standard attributes and nothing else. */
export function describeServerStandardAttributes(renderAttributes: RenderAttributes): void {
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
}

import { renderToString } from "@qwik.dev/core/server";
import { describe, expect, it } from "vitest";

import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";
import { type WidgetName, widgetNames, widgetTags } from "@zitadel/sdk-core/types";

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
    [...(open?.[1] ?? "").matchAll(/([a-z][\w-]*)(?:="([^"]*)")?/gi)].map((m) => [
      m[1]?.toLowerCase(),
      m[2] ?? "",
    ]),
  );
}

const SDK = "qwik";

// server-render-cases:begin
// These cases are copied verbatim into every SDK spec that writes widget
// attributes into markup (see the drift check in sdk-core's contract.spec.ts).
// Each spec supplies its own `renderAttributes`; only that function differs.
type ServerRenderCase = {
  readonly title: string;
  readonly widget: "login" | "session" | "logout";
  readonly props: Readonly<Record<string, unknown>>;
  readonly present: Readonly<Record<string, string>>;
  readonly absent: readonly string[];
  /** SDKs whose markup does not do this yet: not covered, so the row is not run there. */
  readonly gaps?: readonly string[];
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
    absent: [],
    gaps: ["svelte"],
  },
  {
    title: "lets the project handle win over conflicting discrete props in the login markup",
    widget: "login",
    props: { project: SERVER_RENDER_HANDLE, projectId: "proj-other", proxyPath: "/__other" },
    present: { "project-id": "proj-handle", "proxy-path": "/__handle" },
    absent: [],
    gaps: ["svelte"],
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
    gaps: ["svelte"],
  },
  {
    title: "puts the default purpose into the login markup",
    widget: "login",
    props: { projectId: "p1" },
    present: { purpose: "login" },
    absent: [],
    gaps: ["svelte"],
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
    gaps: ["vue", "angular", "svelte", "solid", "qwik"],
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
    title: "puts the display options into the login markup",
    widget: "login",
    props: { projectId: "p1", variant: "page", theme: "dark" },
    present: { variant: "page", theme: "dark" },
    absent: [],
    gaps: ["react", "svelte"],
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
    absent: [],
    gaps: ["svelte"],
  },
  {
    title: "lets the project handle win over conflicting discrete props in the session markup",
    widget: "session",
    props: { project: SERVER_RENDER_HANDLE, projectId: "proj-other", proxyPath: "/__other" },
    present: { "project-id": "proj-handle", "proxy-path": "/__handle" },
    absent: [],
    gaps: ["svelte"],
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
    title: "leaves a keyed project handle out of the session markup",
    widget: "session",
    props: {
      project: { ...SERVER_RENDER_HANDLE, publishableKey: "pk_test_123" },
      projectId: "proj-other",
    },
    present: {},
    absent: ["project-id", "proxy-path", "url"],
    gaps: ["vue", "angular", "svelte", "solid", "qwik"],
  },
  {
    title: "leaves a keyed project handle out of the logout markup",
    widget: "logout",
    props: {
      project: { ...SERVER_RENDER_HANDLE, publishableKey: "pk_test_123" },
      projectId: "proj-other",
    },
    present: {},
    absent: ["project-id", "proxy-path", "url"],
    gaps: ["vue", "angular", "svelte", "solid", "qwik"],
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
    absent: [],
    gaps: ["svelte"],
  },
  {
    title: "lets the project handle win over conflicting discrete props in the logout markup",
    widget: "logout",
    props: { project: SERVER_RENDER_HANDLE, projectId: "proj-other", proxyPath: "/__other" },
    present: { "project-id": "proj-handle", "proxy-path": "/__handle" },
    absent: [],
    gaps: ["svelte"],
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
    gaps: ["react", "vue", "angular"],
  },
  {
    title: "normalizes an empty proxy path to the site root in the session markup",
    widget: "session",
    props: { projectId: "p1", proxyPath: "" },
    present: { "proxy-path": "/" },
    absent: [],
    gaps: ["react", "vue", "angular"],
  },
  {
    title: "normalizes an empty proxy path to the site root in the logout markup",
    widget: "logout",
    props: { projectId: "p1", proxyPath: "" },
    present: { "proxy-path": "/" },
    absent: [],
    gaps: ["react", "vue", "angular"],
  },
  {
    title: "puts the heading into the session markup",
    widget: "session",
    props: { projectId: "p1", heading: "Welcome" },
    present: { heading: "Welcome" },
    absent: [],
    gaps: ["react", "svelte"],
  },
  {
    title: "puts the logout label into the session markup",
    widget: "session",
    props: { projectId: "p1", logoutLabel: "Leave" },
    present: { "logout-label": "Leave" },
    absent: [],
    gaps: ["react", "svelte"],
  },
  {
    title: "leaves an unset heading and logout label out of the session markup",
    widget: "session",
    props: { projectId: "p1" },
    present: {},
    absent: ["heading", "logout-label"],
  },
];

describe("server-rendered widget config", () => {
  const covered = SERVER_RENDER_CASES.filter((c) => !c.gaps?.includes(SDK));

  it.each(covered)("$title", async ({ widget, props, present, absent }) => {
    const attributes = await renderAttributes(widget, props);
    expect(attributes).toMatchObject(present);
    for (const name of absent) expect(attributes).not.toHaveProperty(name);
  });
});
// server-render-cases:end

describe("server-rendered qwik attribute serialization", () => {
  it("emits the login config in the server HTML", async () => {
    const attrs = await serverAttributes(
      widgetTags.login,
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

  it("omits a null resume handle", async () => {
    const attrs = await serverAttributes(
      widgetTags.login,
      <ZitadelLogin project={project} resumeFlowId={null} />,
    );

    expect(attrs).not.toHaveProperty("resume-flow-id");
  });

  it("emits the logout config in the server HTML", async () => {
    const attrs = await serverAttributes(
      widgetTags.logout,
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
      widgetTags.session,
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
});

/** The attributes on the widget's element in the markup a server would send. */
async function renderAttributes(
  widget: WidgetName,
  props: Readonly<Record<string, unknown>>,
): Promise<Record<string, string>> {
  const Widget = { login: ZitadelLogin, logout: ZitadelLogout, session: ZitadelSession }[widget];
  const { tabindex, ...rest } = props;
  return serverAttributes(
    widgetTags[widget],
    <Widget {...rest} {...(typeof tabindex === "string" ? { tabIndex: Number(tabindex) } : {})} />,
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

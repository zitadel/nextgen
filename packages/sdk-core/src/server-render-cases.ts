import { WIDGET_ATTRIBUTES } from "./attributes.js";

type Widget = keyof typeof WIDGET_ATTRIBUTES;

/** One server-render expectation, shared by every SDK's wrapper spec. */
export interface ServerRenderCase {
  readonly title: string;
  readonly widget: Widget;
  /** Props the wrapper is rendered with. */
  readonly props: Readonly<Record<string, unknown>>;
  /** Attributes the opening tag must carry, with their values. */
  readonly present: Readonly<Record<string, string>>;
  /** Attributes the opening tag must not carry. */
  readonly absent: readonly string[];
}

/** The `describe` title every SDK's server-render block uses. */
export const SERVER_RENDER_SUITE = "server-rendered widget config";

const handle = { projectId: "proj-test", proxyPath: "/__nextgen", url: "http://auth.test" };
const handleAttributes = { "project-id": "proj-test", "proxy-path": "/__nextgen", url: handle.url };
const PROJECT_ATTRIBUTES = ["project-id", "proxy-path", "url"];

/** Every attribute a widget can write, except the `purpose` the wrappers default. */
const attributesOf = (widget: Widget): string[] =>
  Object.values(WIDGET_ATTRIBUTES[widget]).flatMap((rule) =>
    rule && rule.attribute !== "purpose" ? [rule.attribute] : [],
  );

function casesFor(widget: Widget): ServerRenderCase[] {
  const at = `the ${widget} markup`;
  const base = { widget, absent: [] as readonly string[] };
  return [
    {
      ...base,
      title: `puts the discrete project props into ${at}`,
      props: { projectId: "p1", proxyPath: "/px" },
      present: { "project-id": "p1", "proxy-path": "/px" },
    },
    {
      ...base,
      title: `puts the project handle into ${at}`,
      props: { project: handle },
      present: handleAttributes,
    },
    {
      ...base,
      title: `lets the project handle win over conflicting discrete props in ${at}`,
      props: { project: handle, projectId: "other", proxyPath: "/other" },
      present: handleAttributes,
    },
    {
      ...base,
      title: `writes an empty proxy path as / in ${at}`,
      props: { projectId: "p1", proxyPath: "" },
      present: { "project-id": "p1", "proxy-path": "/" },
    },
    {
      ...base,
      title: `leaves a keyed project handle out of ${at}`,
      props: { project: { ...handle, publishableKey: "pk_test_123" }, projectId: "other" },
      present: {},
      absent: PROJECT_ATTRIBUTES,
    },
    {
      ...base,
      title: `writes nothing for no config in ${at}`,
      props: {},
      present: {},
      absent: attributesOf(widget),
    },
  ];
}

const LOGIN_ONLY: ServerRenderCase[] = [
  {
    title: "puts the login flow config into the server markup",
    widget: "login",
    props: {
      project: handle,
      purpose: "register",
      flowName: "signup",
      postSignInUrl: "/home",
      resumeFlowId: "flow-1",
    },
    present: {
      ...handleAttributes,
      purpose: "register",
      "flow-name": "signup",
      "post-sign-in-url": "/home",
      "resume-flow-id": "flow-1",
    },
    absent: [],
  },
  {
    title: "puts the login display options into the server markup",
    widget: "login",
    props: { project: handle, variant: "page", theme: "dark", lang: "de" },
    present: { variant: "page", theme: "dark", lang: "de" },
    absent: [],
  },
  {
    title: "writes a true boolean as a present attribute in the login markup",
    widget: "login",
    props: { project: handle, suppressHeader: true, suppressPasswordToggle: true },
    present: { "suppress-header": "", "suppress-password-toggle": "" },
    absent: [],
  },
  {
    title: "leaves a false boolean out of the login markup",
    widget: "login",
    props: { project: handle, suppressHeader: false, suppressPasswordToggle: false },
    present: {},
    absent: ["suppress-header", "suppress-password-toggle"],
  },
  {
    title: "leaves unset values out of the login markup",
    widget: "login",
    props: { project: handle, flowName: "", resumeFlowId: null, lang: undefined },
    present: {},
    absent: ["flow-name", "resume-flow-id", "lang"],
  },
];

const SESSION_ONLY: ServerRenderCase[] = [
  {
    title: "puts the session config into the server markup",
    widget: "session",
    props: {
      project: handle,
      postSignOutUrl: "/bye",
      heading: "Hi",
      logoutLabel: "Out",
      variant: "page",
      theme: "light",
    },
    present: {
      ...handleAttributes,
      "post-sign-out-url": "/bye",
      heading: "Hi",
      "logout-label": "Out",
      variant: "page",
      theme: "light",
    },
    absent: [],
  },
  {
    title: "writes a true boolean as a present attribute in the session markup",
    widget: "session",
    props: { project: handle, suppressHeader: true },
    present: { "suppress-header": "" },
    absent: [],
  },
  {
    title: "leaves a false boolean out of the session markup",
    widget: "session",
    props: { project: handle, suppressHeader: false },
    present: {},
    absent: ["suppress-header"],
  },
  {
    title: "leaves unset values out of the session markup",
    widget: "session",
    props: { project: handle, postSignOutUrl: "", heading: undefined },
    present: {},
    absent: ["post-sign-out-url", "heading"],
  },
];

const LOGOUT_ONLY: ServerRenderCase[] = [
  {
    title: "puts the logout config into the server markup",
    widget: "logout",
    props: { project: handle, postSignOutUrl: "/bye", theme: "dark" },
    present: { ...handleAttributes, "post-sign-out-url": "/bye", theme: "dark" },
    absent: [],
  },
  {
    title: "leaves unset values out of the logout markup",
    widget: "logout",
    props: { project: handle, postSignOutUrl: "", theme: undefined },
    present: {},
    absent: ["post-sign-out-url", "theme"],
  },
];

/**
 * The server-render expectations every SDK's wrapper spec runs: the same rows
 * and titles in each, differing only in how the framework renders the markup.
 */
export const SERVER_RENDER_CASES: readonly ServerRenderCase[] = [
  ...(["login", "session", "logout"] as const).flatMap(casesFor),
  ...LOGIN_ONLY,
  ...SESSION_ONLY,
  ...LOGOUT_ONLY,
];

import type { ZitadelLoginConfig, ZitadelLogoutConfig, ZitadelSessionConfig } from "./types.js";

/**
 * A handle that carries a publishable key writes no project attributes, until
 * the elements read a `publishable-key` attribute. Attributes cannot carry the
 * key, so a widget that started from them would send its first request without
 * the bearer the project needs and never retry; left unconfigured it waits for
 * the handle the framework binds as a property. Flip this, and write the key,
 * when the attribute exists.
 */
const PUBLISHABLE_KEY_ATTRIBUTE_EXISTS = false;

/** How one config key reaches the element: `null` means property only. */
type AttributeRule = { readonly attribute: string; readonly flag?: true } | null;

/** The fields of a `project` handle that outrank the discrete props and `url`. */
const HANDLE_FIELDS = ["projectId", "proxyPath", "url"] as const;

/**
 * The element attribute each widget config key is written as in server
 * markup. Declared once: a key added to a config type fails `tsc` here until
 * it is given a rule, and `contract.spec.ts` checks the keys and attribute
 * names against the elements' own properties. `url` is not a config key (the
 * wrappers take the backend from `project`), but it is written from the
 * handle, so it is listed with the others.
 */
export const WIDGET_ATTRIBUTES = {
  login: {
    project: null,
    projectId: { attribute: "project-id" },
    proxyPath: { attribute: "proxy-path" },
    url: { attribute: "url" },
    variant: { attribute: "variant" },
    theme: { attribute: "theme" },
    suppressHeader: { attribute: "suppress-header", flag: true },
    suppressPasswordToggle: { attribute: "suppress-password-toggle", flag: true },
    purpose: { attribute: "purpose" },
    flowName: { attribute: "flow-name" },
    postSignInUrl: { attribute: "post-sign-in-url" },
    resumeFlowId: { attribute: "resume-flow-id" },
    locales: null,
    lang: { attribute: "lang" },
  },
  session: {
    project: null,
    projectId: { attribute: "project-id" },
    proxyPath: { attribute: "proxy-path" },
    url: { attribute: "url" },
    postSignOutUrl: { attribute: "post-sign-out-url" },
    heading: { attribute: "heading" },
    logoutLabel: { attribute: "logout-label" },
    variant: { attribute: "variant" },
    theme: { attribute: "theme" },
    suppressHeader: { attribute: "suppress-header", flag: true },
  },
  logout: {
    project: null,
    projectId: { attribute: "project-id" },
    proxyPath: { attribute: "proxy-path" },
    url: { attribute: "url" },
    postSignOutUrl: { attribute: "post-sign-out-url" },
    theme: { attribute: "theme" },
  },
} as const satisfies {
  login: Record<keyof ZitadelLoginConfig, AttributeRule> & { url: AttributeRule };
  session: Record<keyof ZitadelSessionConfig, AttributeRule> & { url: AttributeRule };
  logout: Record<keyof ZitadelLogoutConfig, AttributeRule> & { url: AttributeRule };
};

interface WidgetConfigs {
  readonly login: ZitadelLoginConfig;
  readonly session: ZitadelSessionConfig;
  readonly logout: ZitadelLogoutConfig;
}

/**
 * The attributes that carry a widget's configuration in server markup, keyed
 * by attribute name (kebab-case). A `project` handle wins over the discrete
 * `projectId` / `proxyPath`, an empty proxy path is written as `/` (an empty
 * `proxy-path` attribute reads as unset), a boolean is present (`""`) or
 * absent, and an unset value is left out. Each SDK spreads the result onto its
 * element and keeps its own way of assigning the properties.
 */
export function widgetAttributes<W extends keyof WidgetConfigs>(
  widget: W,
  config: WidgetConfigs[W],
): Record<string, string> {
  const given: Record<string, unknown> = { ...config };
  const handle: Record<string, unknown> = { ...config.project };
  const keyed = Boolean(config.project?.publishableKey) && !PUBLISHABLE_KEY_ATTRIBUTE_EXISTS;
  const attributes: Record<string, string> = {};

  for (const [key, rule] of Object.entries<AttributeRule>(WIDGET_ATTRIBUTES[widget])) {
    if (!rule) continue;
    const fromHandle = (HANDLE_FIELDS as readonly string[]).includes(key);
    if (fromHandle && keyed) continue;
    const value = fromHandle ? (handle[key] ?? given[key]) : given[key];
    if (key === "proxyPath" && value === "") {
      attributes[rule.attribute] = "/";
    } else if (value === true && rule.flag) {
      attributes[rule.attribute] = "";
    } else if (typeof value === "string" && value !== "") {
      attributes[rule.attribute] = value;
    }
  }
  return attributes;
}

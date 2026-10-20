import { createComponent, type EventName } from "@lit/react";
import {
  configureZitadel,
  getApi,
  getZitadelConfig,
  type ZitadelConfig,
  type ZitadelProject,
} from "@zitadel/api/config";
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";
import {
  isStandardAttributeName,
  standardAttributes,
  widgetTags,
  type WidgetTag,
} from "@zitadel/sdk-core/types";
import * as React from "react";
// Registers <zitadel-login> / <zitadel-logout> / <zitadel-session> with the
// browser. On an edge runtime the package resolves to an entry without the
// elements, so importing it there is harmless. No element class is imported
// here: the components look the class up by tag name when they render.
import "@zitadel/components";

import type {
  ZitadelFlowCompleteDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
  ZitadelLoginProps,
  ZitadelLogoutProps,
  ZitadelSessionProps,
  ZitadelSignoutDetail,
  ZitadelWidgetAttributes,
} from "./types";

export { configureZitadel, getApi, getZitadelConfig };
export type { ZitadelConfig, ZitadelProject };
export * from "./types";

// Re-exported so scaffolded apps can wire the business copy overlay without a
// direct @zitadel/components dependency (strict package managers reject those).
export { businessLocales } from "@zitadel/components";

/**
 * React components for the Zitadel auth widgets.
 *
 * These wrap the framework-agnostic Lit web components from
 * `@zitadel/components` with `@lit/react`'s `createComponent`, so they are real
 * React components: the SDK `project` handle is bound as a DOM *property* (not
 * an attribute) — which is what the elements read at startup — and the widget's
 * `zitadel-*` events are registered as element listeners via the `events` map
 * and surfaced as optional callbacks receiving the event detail.
 *
 * In a client-side SPA, build the handle with `configureZitadel(...)` and pass
 * it as the `project` prop. Because the SPA renders after configuration, the
 * prop is present when the element upgrades:
 *
 * ```tsx
 * import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-react";
 *
 * const project = configureZitadel({ projectId: "…", proxyPath: "/__nextgen" });
 *
 * export function LoginPage() {
 *   return <ZitadelLogin project={project} purpose="login" postSignInUrl="/" />;
 * }
 * ```
 */
/**
 * `createComponent` binds every key found on the element's prototype as a DOM
 * property, and a property is never written into server markup. The widget
 * starts its first flow when it upgrades, before React hydrates, so the keys
 * that define that flow must reach the browser as attributes. This hides the
 * given keys from that lookup: they are passed through as plain attributes
 * (server markup included) and the element still reads them as properties.
 * On the server the standard HTML attributes (`id`, `title`, `slot`, `role`, …)
 * are hidden too, so they are in the server markup; in the browser `createComponent`
 * keeps them, since it removes such an attribute when its prop goes, which React 19
 * does not do for a custom element.
 *
 * No element class is imported, because loading one needs a DOM and an edge
 * runtime has none. In the browser the prototype is the one of the class
 * registered under `tag`, looked up whenever a prop is classified. On the
 * server there is no class to ask: a prop this wrapper passes is a property
 * unless it is hidden, a standard attribute or a kebab-case attribute name.
 */
function asAttributes<Tag extends WidgetTag>(
  tag: Tag,
  ...keys: readonly string[]
): { new (): HTMLElementTagNameMap[Tag]; prototype: HTMLElementTagNameMap[Tag] } {
  const hidden = new Set<PropertyKey>(keys);
  const prototype = new Proxy(
    {},
    {
      has: (_target, key) => {
        if (hidden.has(key)) return false;
        if (typeof document !== "undefined")
          return key in (customElements.get(tag)?.prototype ?? {});
        return (
          typeof key === "string" &&
          !["children", "localName", "ref"].includes(key) &&
          !isStandardAttributeName(key) &&
          !key.includes("-")
        );
      },
    },
  );
  return { name: tag, prototype } as unknown as {
    new (): HTMLElementTagNameMap[Tag];
    prototype: HTMLElementTagNameMap[Tag];
  };
}

/**
 * The project coordinates as attributes, so they are in the server markup. The
 * `project` handle stays a property too: it carries the publishable key and is
 * what the element prefers once React hands it over.
 *
 * A handle with a publishable key writes none: attributes cannot carry the key,
 * so a widget that started from them would send its first request without the
 * bearer the project needs, and never retry. `ZitadelLogin` renders nothing for
 * such a handle until it has mounted, so its element is created with the
 * handle already bound.
 */
function projectAttributes(props: {
  readonly project?: ZitadelProject;
  readonly projectId?: string;
  readonly proxyPath?: string;
}) {
  if (props.project?.publishableKey) return {};
  return {
    "project-id": props.project?.projectId ?? props.projectId,
    "proxy-path": props.project?.proxyPath ?? props.proxyPath,
    url: props.project?.url,
  };
}

const ZitadelLoginElementReact = createComponent({
  react: React,
  tagName: widgetTags.login,
  elementClass: asAttributes(widgetTags.login, "purpose", "resumeFlowId", "postSignInUrl", "url"),
  events: {
    onZitadelFlowStep: "zitadel-flow-step" as EventName<CustomEvent<ZitadelFlowStepDetail>>,
    onZitadelFlowInput: "zitadel-flow-input" as EventName<CustomEvent<ZitadelFlowInputDetail>>,
    onZitadelFlowComplete: "zitadel-flow-complete" as EventName<
      CustomEvent<ZitadelFlowCompleteDetail>
    >,
    onZitadelFlowRedirect: "zitadel-flow-redirect" as EventName<
      CustomEvent<ZitadelFlowRedirectDetail>
    >,
    onZitadelFlowError: "zitadel-flow-error" as EventName<CustomEvent<ZitadelFlowErrorDetail>>,
  },
});

const ZitadelLogoutElementReact = createComponent({
  react: React,
  tagName: widgetTags.logout,
  elementClass: asAttributes(widgetTags.logout, "url"),
  events: {
    onZitadelSignout: "zitadel-signout" as EventName<CustomEvent<ZitadelSignoutDetail>>,
  },
});

const ZitadelSessionElementReact = createComponent({
  react: React,
  tagName: widgetTags.session,
  elementClass: asAttributes(widgetTags.session, "url"),
  events: {
    onZitadelSignout: "zitadel-signout" as EventName<CustomEvent<ZitadelSignoutDetail>>,
  },
});

/**
 * React component wrapping the `<zitadel-login>` web component. Binds the
 * `ZitadelProject` handle as a DOM property (or the discrete project id /
 * proxy path as attributes) and forwards the widget's `zitadel-*` events as
 * optional callbacks.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-login>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
/**
 * `ZitadelLoginProps` is framework-agnostic, so it carries no `children`.
 * React hosts need them: the widget exposes slots (`attribution-trailing`)
 * that are filled with light-DOM content.
 */
export type ZitadelLoginReactProps = ZitadelLoginProps &
  ZitadelWidgetAttributes & {
    children?: React.ReactNode;
    /**
     * Preview mode, for an operator surface: the flow starts as usual, then the
     * element shows the served step in this state and submits nothing.
     */
    previewState?: ZitadelLoginElement["previewState"];
    /** The terminal step the `success` preview paints; the element's `done` when unset. */
    previewSuccessStep?: string;
  };

export const ZitadelLogin = React.forwardRef<ZitadelLoginElement, ZitadelLoginReactProps>(
  function ZitadelLogin(
    {
      purpose,
      resumeFlowId,
      postSignInUrl,
      onFlowStep,
      onFlowInput,
      onFlowComplete,
      onFlowRedirect,
      onFlowError,
      ...props
    },
    ref,
  ) {
    // The standard HTML attributes are the only extra props the element takes.
    const attributes = standardAttributes(props);
    const keyed = Boolean(props.project?.publishableKey);
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);
    // A keyed handle cannot reach the element as attributes, and the element
    // starts its first flow when it first updates. Create it only once the
    // handle can be bound at the same time, never during server rendering.
    if (keyed && !mounted) return null;
    return (
      <ZitadelLoginElementReact
        {...attributes}
        ref={ref}
        project={props.project}
        projectId={props.projectId}
        proxyPath={props.proxyPath}
        variant={props.variant}
        theme={props.theme}
        suppressHeader={props.suppressHeader}
        suppressPasswordToggle={props.suppressPasswordToggle}
        forcePostSignInUrl={props.forcePostSignInUrl}
        locales={props.locales}
        lang={props.lang}
        previewState={props.previewState}
        previewSuccessStep={props.previewSuccessStep}
        purpose={purpose ?? "login"}
        flow-name={props.flowName}
        {...projectAttributes(props)}
        resume-flow-id={resumeFlowId || undefined}
        post-sign-in-url={postSignInUrl || undefined}
        onZitadelFlowStep={onFlowStep && ((event) => onFlowStep(event.detail))}
        onZitadelFlowInput={onFlowInput && ((event) => onFlowInput(event.detail))}
        onZitadelFlowComplete={onFlowComplete && ((event) => onFlowComplete(event.detail))}
        onZitadelFlowRedirect={onFlowRedirect && ((event) => onFlowRedirect(event.detail))}
        onZitadelFlowError={onFlowError && ((event) => onFlowError(event.detail))}
      >
        {props.children}
      </ZitadelLoginElementReact>
    );
  },
);

ZitadelLogin.displayName = "ZitadelLogin";

/** Props of `ZitadelLogout`: the widget's own plus the standard HTML attributes. */
export type ZitadelLogoutReactProps = ZitadelLogoutProps & ZitadelWidgetAttributes;

/**
 * React component wrapping the `<zitadel-logout>` web component. Binds the
 * `ZitadelProject` handle as a DOM property (or the discrete project id /
 * proxy path as attributes) and forwards the widget's `zitadel-signout` event
 * as an optional callback.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-logout>` DOM element,
 * so consumers can imperatively access the upgraded web component.
 */
export const ZitadelLogout = React.forwardRef<ZitadelLogoutElement, ZitadelLogoutReactProps>(
  function ZitadelLogout({ onSignout, ...props }, ref) {
    // The standard HTML attributes are the only extra props the element takes.
    const attributes = standardAttributes(props);
    return (
      <ZitadelLogoutElementReact
        {...attributes}
        project={props.project}
        projectId={props.projectId}
        proxyPath={props.proxyPath}
        theme={props.theme}
        {...projectAttributes(props)}
        post-sign-out-url={props.postSignOutUrl}
        ref={ref}
        onZitadelSignout={onSignout && ((event) => onSignout(event.detail))}
      />
    );
  },
);

ZitadelLogout.displayName = "ZitadelLogout";

/** Props of `ZitadelSession`: the widget's own plus the standard HTML attributes. */
export type ZitadelSessionReactProps = ZitadelSessionProps & ZitadelWidgetAttributes;

/**
 * React component wrapping the `<zitadel-session>` web component — the
 * post-sign-in "signed in as" card. Binds the `ZitadelProject` handle as a DOM
 * property (or the discrete project id / proxy path as attributes) and forwards
 * the widget's `zitadel-signout` event as an optional callback.
 *
 * A forwarded `ref` resolves to the underlying `<zitadel-session>` DOM element.
 */
export const ZitadelSession = React.forwardRef<ZitadelSessionElement, ZitadelSessionReactProps>(
  function ZitadelSession({ onSignout, ...props }, ref) {
    // The standard HTML attributes are the only extra props the element takes.
    const attributes = standardAttributes(props);
    return (
      <ZitadelSessionElementReact
        {...attributes}
        project={props.project}
        projectId={props.projectId}
        proxyPath={props.proxyPath}
        heading={props.heading}
        logoutLabel={props.logoutLabel}
        variant={props.variant}
        theme={props.theme}
        suppressHeader={props.suppressHeader}
        {...projectAttributes(props)}
        post-sign-out-url={props.postSignOutUrl}
        ref={ref}
        onZitadelSignout={onSignout && ((event) => onSignout(event.detail))}
      />
    );
  },
);

ZitadelSession.displayName = "ZitadelSession";

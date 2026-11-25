import type { ZitadelProject } from "@zitadel/api/config";
import type { ZitadelLogin as ZitadelLoginElement } from "@zitadel/components";
import type {
  ZitadelFlowPurpose,
  ZitadelFlowCompleteDetail,
  ZitadelFlowRedirectDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
} from "@zitadel/sdk-core/types";

import { standardAttributes, widgetTags } from "@zitadel/sdk-core/types";
import { defineComponent, h, type PropType, ref, toRaw } from "vue";
// Registers <zitadel-login> / <zitadel-logout> with the browser. Imported at
// module load (before render) so the element is upgraded by the time Vue
// patches it — which means Vue binds `project` as a DOM *property* (not a
// stringified attribute).
import "@zitadel/components";

import type { WithZitadelWidgetAttributes } from "../types.js";
import { forceAttr } from "./forceAttr";

/**
 * The component that {@link ZitadelLogin} is typed from, before the standard HTML attributes are added to
 * its props.
 *
 * It is exported only so that the published declaration file can name it. Import
 * {@link ZitadelLogin} instead, which has the same runtime value and the complete props type.
 */
export const Base = defineComponent({
  name: "ZitadelLogin",
  // The element takes only the standard attributes (see below), never the rest of `attrs`.
  inheritAttrs: false,
  props: {
    /**
     * The project handle that the widget signs users in to.
     *
     * Pass the value that {@link configureZitadel} returns. The component binds it as a DOM
     * property, raw and not as Vue's reactive proxy, because the widget compares it by identity.
     * It also writes the handle's fields as the `project-id`, `proxy-path` and `url` attributes, so
     * server-rendered markup carries them before hydration. It wins over
     * {@link ZitadelLoginProps.projectId} and {@link ZitadelLoginProps.proxyPath}.
     *
     * @example
     * ```html
     * <ZitadelLogin :project="project" />
     * ```
     */
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    /**
     * The project id that the widget signs users in to.
     *
     * Use it in an app that has no project handle. It is ignored when {@link ZitadelLoginProps.project} is set.
     * The component writes it as the `project-id` attribute, so it reaches server-rendered markup.
     *
     * @example
     * ```html
     * <ZitadelLogin project-id="296547382910273" />
     * ```
     */
    projectId: { type: String, default: undefined },
    /**
     * The same-origin proxy path that the widget calls.
     *
     * Use it in an app that has no project handle. It is ignored when {@link ZitadelLoginProps.project} is set.
     * The component writes it as the `proxy-path` attribute, so it reaches server-rendered markup.
     * The host or dev server of the app must serve the path.
     *
     * @defaultValue "/__nextgen"
     */
    proxyPath: { type: String, default: undefined },
    /**
     * The purpose of the flow to start.
     *
     * Use `"login"` for a sign-in page and the other purposes for registration or recovery pages.
     * The flow starts when the widget mounts, so changing the value later does not restart it.
     *
     * @defaultValue "login"
     */
    purpose: {
      type: String as PropType<ZitadelFlowPurpose>,
      default: "login",
    },
    /**
     * The address to navigate to after a completed sign-in.
     *
     * A same-origin `next` query parameter on the page wins over it unless
     * {@link ZitadelLoginProps.forcePostSignInUrl} is set. That keeps a user on the route that sent them to
     * the sign-in page. Only a path on the origin of the page is followed. A full URL, a scheme, a
     * protocol-relative address or a path with control characters is refused and the widget falls
     * back to this value. Unset, the widget uses its own default.
     *
     * @example
     * ```html
     * <ZitadelLogin :project="project" post-sign-in-url="/dashboard" />
     * ```
     */
    postSignInUrl: { type: String, default: undefined },
    /**
     * Whether to navigate to {@link ZitadelLoginProps.postSignInUrl} even when the `next` query parameter names a
     * path.
     *
     * Set it on a page that uses `next` for something of its own, or whose router is mounted under
     * a prefix that the plain `next` path lacks. Unset, the `next` parameter wins.
     *
     * @defaultValue false
     */
    forcePostSignInUrl: { type: Boolean, default: undefined },
    /**
     * The id of an existing flow to resume instead of starting a new one.
     *
     * Use it when the server rendered or created the flow and the widget must continue it. Unset,
     * `null` or `""` falls back to the `flow` query parameter, so clearing the prop behaves like
     * never setting it. An id that no longer resolves starts a new flow.
     */
    resumeFlowId: { type: String as PropType<string | null>, default: undefined },
    /**
     * The copy overrides that the widget merges over its built-in dictionaries.
     *
     * The keys are primary language subtags and the values map message keys to text. The component
     * hands the widget the raw object and not Vue's reactive proxy, and binds it as a DOM property.
     * Pass {@link businessLocales} for the business copy overlay.
     *
     * @example
     * ```html
     * <ZitadelLogin :project="project" :locales="{ en: { 'login.title': 'Welcome back' } }" />
     * ```
     */
    locales: {
      type: Object as PropType<Record<string, Partial<Record<string, string>>>>,
      default: undefined,
    },
    /**
     * The BCP-47 language tag that overrides the language of the widget.
     *
     * Unset, the widget uses the browser language.
     * The component binds it as an attribute, so an unset prop removes the attribute and the
     * element keeps its own default. Vue would assign an unset property to a custom element as an
     * empty string, which the element cannot tell from an intended empty string.
     *
     * @example "de"
     */
    lang: { type: String, default: undefined },
    /**
     * The name of the flow definition to run.
     *
     * Unset, the widget runs the default flow of the project for the
     * {@link ZitadelLoginProps.purpose}.
     */
    flowName: { type: String, default: undefined },
    /**
     * The layout of the widget: `"widget"` or `"page"`.
     *
     * The `"widget"` layout is sized by its content and paints no page chrome. The `"page"` layout
     * claims the viewport and paints the surface background, for a dedicated sign-in route.
     * The component binds it as an attribute, so an unset prop removes the attribute and the
     * element keeps its own default. Vue would assign an unset property to a custom element as an
     * empty string, which the element cannot tell from an intended empty string.
     * On the server it is written as a plain attribute.
     *
     * @defaultValue "widget"
     */
    variant: { type: String as PropType<"widget" | "page">, default: undefined },
    /**
     * The color mode of the widget: `"light"`, `"dark"` or `"auto"`.
     *
     * The value `"auto"` follows `prefers-color-scheme`. Unset, the widget follows the branding
     * theme of the tenant and then the default of the {@link ZitadelLoginProps.variant}. The
     * component binds it as an attribute, so an unset prop keeps the default of the element and
     * is not turned into an empty string.
     */
    theme: { type: String as PropType<"light" | "dark" | "auto">, default: undefined },
    /**
     * Whether to hide the heading block of the widget visually while keeping it in the accessibility
     * tree.
     *
     * Set it on a page that already carries its own heading. The component binds it as a property.
     * Vue turns an unset boolean into `false`, which is the default, so an unset prop is safe.
     *
     * @defaultValue false
     */
    suppressHeader: { type: Boolean, default: undefined },
    /**
     * Whether to hide the show and hide button on password fields.
     *
     * The component binds it as a property. Vue turns an unset boolean into `false`, which is the
     * default, so an unset prop is safe.
     *
     * @defaultValue false
     */
    suppressPasswordToggle: { type: Boolean, default: undefined },
  },
  /**
   * The events that the component re-emits from the widget, each with the `detail` of the matching
   * `zitadel-*` event as its payload.
   *
   * The `flowStep` event carries a {@link ZitadelFlowStepDetail} when the flow enters a step.
   * The `flowInput` event carries a {@link ZitadelFlowInputDetail} when the user changes a field.
   * The `flowComplete` event carries a {@link ZitadelFlowCompleteDetail} when the flow succeeds.
   * The `flowRedirect` event carries a {@link ZitadelFlowRedirectDetail} when the widget is about
   * to navigate away. The `flowError` event carries a {@link ZitadelFlowErrorDetail} when the flow
   * fails. The `flowRedirect` and `flowComplete` events are emitted just before the widget
   * navigates, so the handler must run synchronously. The `waitUntil` hook that the event detail
   * offers lets a handler delay the navigation for at most two seconds, which matters only for
   * asynchronous work. Vue emits are synchronous, so a plain handler needs no hook.
   */
  emits: ["flowStep", "flowInput", "flowComplete", "flowRedirect", "flowError"],
  setup(props, { attrs, emit, expose }) {
    // Template ref to the rendered Lit element. Exposed so a consumer's
    // component `ref` (which resolves to this instance) can reach the DOM node.
    const element = ref<ZitadelLoginElement | null>(null);
    expose({ element });

    return () => {
      // The standard HTML attributes are the only extra props the element takes.
      const attributes = standardAttributes(attrs);
      const attr = forceAttr();
      return h(widgetTags.login, {
        ...attributes,
        ref: element,
        // Hand the Lit element the raw SDK handle, not Vue's reactive proxy:
        // the widget does identity checks on it (and `render` from test-utils
        // would otherwise pass a wrapped clone).
        project: toRaw(props.project),
        // Kebab-case attributes are what the element reads at upgrade, and the
        // only form a server-rendered page carries (the camelCase keys below
        // render as `projectid=`-style names the element never reads). The
        // handle's fields are mirrored, and win over the discrete props as they
        // do in the widget's `resolveApi`, so a page that passes only `project`
        // is configured before hydration and both channels agree.
        "project-id": props.project?.projectId ?? props.projectId,
        "proxy-path": props.project?.proxyPath ?? props.proxyPath,
        url: props.project?.url,
        projectId: props.projectId,
        proxyPath: props.proxyPath,
        purpose: props.purpose,
        "post-sign-in-url": props.postSignInUrl,
        forcePostSignInUrl: props.forcePostSignInUrl,
        "resume-flow-id": props.resumeFlowId,
        // Same raw-unwrap rationale as `project`: hand the widget the plain
        // dictionaries, not Vue's reactive proxy.
        locales: props.locales === undefined ? undefined : toRaw(props.locales),
        "flow-name": props.flowName,
        // A string prop with a default is bound as an attribute (the "^" prefix on
        // the client, see `forceAttr`): Vue assigns an unset property as "", which
        // the element cannot tell from an intended empty string, while an unset
        // attribute is simply removed.
        [`${attr}lang`]: props.lang,
        [`${attr}variant`]: props.variant,
        [`${attr}theme`]: props.theme,
        suppressHeader: props.suppressHeader,
        suppressPasswordToggle: props.suppressPasswordToggle,
        onZitadelFlowStep: (event: CustomEvent<ZitadelFlowStepDetail>) => {
          emit("flowStep", event.detail);
        },
        onZitadelFlowInput: (event: CustomEvent<ZitadelFlowInputDetail>) => {
          emit("flowInput", event.detail);
        },
        onZitadelFlowComplete: (event: CustomEvent<ZitadelFlowCompleteDetail>) => {
          emit("flowComplete", event.detail);
        },
        onZitadelFlowRedirect: (event: CustomEvent<ZitadelFlowRedirectDetail>) => {
          emit("flowRedirect", event.detail);
        },
        onZitadelFlowError: (event: CustomEvent<ZitadelFlowErrorDetail>) => {
          emit("flowError", event.detail);
        },
      });
    };
  },
});

/**
 * Renders the sign-in widget, the `<zitadel-login>` web component, inside a Vue template.
 *
 * Use it on the sign-in route of a client-side app or inside a dialog. The component is a render
 * function that creates the element by its string tag, so Vue never tries to resolve
 * `zitadel-login` as a Vue component and no `compilerOptions.isCustomElement` setting is needed.
 *
 * Pass the project handle from {@link configureZitadel} as `project`, or the discrete `project-id`
 * and `proxy-path` props. The handle wins when both are present. The widget events are re-emitted
 * with their detail as `flowStep`, `flowInput`, `flowComplete`, `flowRedirect` and `flowError`. The
 * component accepts the standard HTML attributes as described by {@link ZitadelLoginProps} and
 * passes only those to the element.
 *
 * On the server, and on edge runtimes where the element is not defined, the component renders the
 * tag with its `project-id` and `proxy-path` attributes and nothing inside. The flow itself renders
 * only in the browser, after hydration. A string prop that is left unset is bound as an attribute
 * on the client and removed, so the element keeps its own default. The kebab-case attributes are
 * the only form the widget reads when it upgrades before Vue hydrates, which is why they are
 * written in addition to the properties. Importing the package loads the element definitions in the
 * browser, so the element is upgraded before Vue patches it and the `project` handle is bound as a
 * property and not as a stringified attribute.
 *
 * A Vue `ref` on this component resolves to the component instance and not to the inner element.
 * The rendered element is exposed as `element`, a `Ref` whose value is the `ZitadelLogin` element
 * from `@zitadel/components`, or `null` before mount.
 *
 * @example
 * ```html
 * <script setup lang="ts">
 * import { ZitadelLogin, configureZitadel } from "@zitadel/sdk-vue";
 *
 * const project = configureZitadel({ projectId: "296547382910273" });
 * </script>
 *
 * <template>
 *   <ZitadelLogin :project="project" post-sign-in-url="/dashboard" @flow-error="console.error" />
 * </template>
 * ```
 */
const ZitadelLogin: WithZitadelWidgetAttributes<typeof Base> = Base;

export default ZitadelLogin;

import type { ZitadelProject } from "@zitadel/api/config";
import type { ZitadelLogin as ZitadelLoginElement } from "@zitadel/components";
import type {
  CreateFlowBodyPurpose,
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
 * The un-augmented component that {@link ZitadelLogin} is typed from, before the
 * standard HTML attributes are added to its props. It is exported only so the
 * published declaration file can name it; import {@link ZitadelLogin} instead.
 */
export const Base = defineComponent({
  name: "ZitadelLogin",
  // The element takes only the standard attributes (see below), never the rest of `attrs`.
  inheritAttrs: false,
  props: {
    /**
     * The handle returned by `configureZitadel(...)`. Bound as a DOM property
     * (raw, not Vue's reactive proxy, because the widget does identity checks
     * on it), and its fields are also written as `project-id`, `proxy-path` and
     * `url` attributes so server-rendered markup carries them. Wins over the
     * discrete {@link projectId} and {@link proxyPath} props.
     */
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    /**
     * Project id, read when no {@link project} handle is passed. Written as the
     * `project-id` attribute so it reaches server-rendered markup.
     */
    projectId: { type: String, default: undefined },
    /**
     * Same-origin path prefix the widget calls (the `/__nextgen` proxy when
     * unset). Read when no {@link project} handle is passed, and written as the
     * `proxy-path` attribute so it reaches server-rendered markup.
     */
    proxyPath: { type: String, default: undefined },
    /**
     * The flow purpose to start. Defaults to `"login"`.
     */
    purpose: {
      type: String as PropType<CreateFlowBodyPurpose>,
      default: "login",
    },
    /**
     * Where to navigate after a completed sign-in. A same-origin `next` query
     * parameter on the page wins over it unless {@link forcePostSignInUrl} is set.
     */
    postSignInUrl: { type: String, default: undefined },
    /**
     * Navigate to {@link postSignInUrl} even when the page's `next` query
     * parameter names a path, for a page that uses `next` for something of its own.
     */
    forcePostSignInUrl: { type: Boolean, default: undefined },
    /**
     * An existing flow's id to resume instead of starting a new one. Unset,
     * `null` or `""` falls back to the `flow` query parameter; an id that no
     * longer resolves starts a new flow.
     */
    resumeFlowId: { type: String as PropType<string | null>, default: undefined },
    /**
     * Copy overrides merged over the builtin dictionaries, keyed by primary
     * language subtag. Handed to the widget as the raw object, not Vue's proxy.
     */
    locales: {
      type: Object as PropType<Record<string, Partial<Record<string, string>>>>,
      default: undefined,
    },
    /**
     * BCP-47 language override; unset uses the browser language. Bound as an
     * attribute so an unset prop is removed.
     */
    lang: { type: String, default: undefined },
    /**
     * Runs the flow definition with this `name`; unset runs the project's
     * default flow for the purpose.
     */
    flowName: { type: String, default: undefined },
    /**
     * `widget` is content-sized and paints no page chrome; `page` claims the
     * viewport and paints the surface background. Unset keeps the element's
     * default (`widget`). Bound as an attribute so an unset prop is removed.
     */
    variant: { type: String as PropType<"widget" | "page">, default: undefined },
    /**
     * Colour mode: `light`, `dark`, or `auto` (follow `prefers-color-scheme`).
     * Unset follows the tenant's branding theme, then the variant default. Bound as an attribute so an unset prop keeps the element's default.
     */
    theme: { type: String as PropType<"light" | "dark" | "auto">, default: undefined },
    /**
     * Visually hides the widget's own heading block while keeping it in the
     * accessibility tree, for pages that already carry the heading. Unset keeps
     * the element's default (`false`).
     */
    suppressHeader: { type: Boolean, default: undefined },
    /**
     * Hides the show/hide button on password fields. Unset keeps the element's
     * default (`false`).
     */
    suppressPasswordToggle: { type: Boolean, default: undefined },
  },
  // Each entry re-emits the widget's matching `zitadel-*` event with its `detail`.
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
 * Vue wrapper for the `<zitadel-login>` Lit web component.
 *
 * Render-function form (string tag) so Vue never tries to resolve
 * `zitadel-login` as a Vue component — no `compilerOptions.isCustomElement`
 * needed. Supply the SDK handle from `configureZitadel(...)` as `:project`, or
 * the discrete `:project-id` / `:proxy-path` the widget reads instead — the
 * widget uses whichever is present. All three are bound as DOM properties, and
 * the discrete values (and the handle's fields) are also written as
 * `project-id` / `proxy-path` / `url` attributes so a server-rendered page
 * carries them before hydration. The widget's `zitadel-*` events are re-emitted
 * with their detail as `flowStep`, `flowInput`, `flowComplete`,
 * `flowRedirect` and
 * `flowError` (the names declared in `emits`).
 *
 * A Vue `ref` on this component resolves to the component *instance*, not the
 * inner element, so the rendered `<zitadel-login>` DOM node is exposed as
 * `element` (a `Ref` whose `.value` is the `ZitadelLogin` element from `@zitadel/components`, or
 * `null` before mount). A consumer with `<ZitadelLogin ref="r" />` reads it via
 * `r.value.element`.
 */
const ZitadelLogin: WithZitadelWidgetAttributes<typeof Base> = Base;

export default ZitadelLogin;

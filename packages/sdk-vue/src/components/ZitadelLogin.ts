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
import { defineComponent, h, mergeProps, type PropType, ref, toRaw } from "vue";
// Registers <zitadel-login> / <zitadel-logout> with the browser. Imported at
// module load (before render) so the element is upgraded by the time Vue
// patches it — which means Vue binds `project` as a DOM *property* (not a
// stringified attribute).
import "@zitadel/components";

import { forceAttr } from "./forceAttr";
import type { WithZitadelWidgetAttributes } from "../types";

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
 * `element` (a `Ref` whose `.value` is the {@link ZitadelLoginElement}, or
 * `null` before mount). A consumer with `<ZitadelLogin ref="r" />` reads it via
 * `r.value.element`.
 */
const ZitadelLogin = defineComponent({
  name: "ZitadelLogin",
  // The standard HTML attributes (class, style, id, data-*, aria-*, …) are merged
  // onto the element below, under the widget's own bindings, rather than left to
  // Vue's automatic fallthrough, which would let them overwrite those bindings.
  inheritAttrs: false,
  props: {
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    projectId: { type: String, default: undefined },
    proxyPath: { type: String, default: undefined },
    purpose: {
      type: String as PropType<CreateFlowBodyPurpose>,
      default: "login",
    },
    postSignInUrl: { type: String, default: undefined },
    forcePostSignInUrl: { type: Boolean, default: undefined },
    resumeFlowId: { type: String as PropType<string | null>, default: undefined },
    locales: {
      type: Object as PropType<Record<string, Partial<Record<string, string>>>>,
      default: undefined,
    },
    lang: { type: String, default: undefined },
    flowName: { type: String, default: undefined },
    variant: { type: String as PropType<"widget" | "page">, default: undefined },
    theme: { type: String as PropType<"light" | "dark" | "auto">, default: undefined },
    suppressHeader: { type: Boolean, default: undefined },
    suppressPasswordToggle: { type: Boolean, default: undefined },
  },
  emits: ["flowStep", "flowInput", "flowComplete", "flowRedirect", "flowError"],
  setup(props, { attrs, emit, expose }) {
    // Template ref to the rendered Lit element. Exposed so a consumer's
    // component `ref` (which resolves to this instance) can reach the DOM node.
    const element = ref<ZitadelLoginElement | null>(null);
    expose({ element });

    return () => {
      // The standard HTML attributes come first, so a widget prop wins over one of the same name.
      const attributes = standardAttributes(attrs);
      const attr = forceAttr();
      return h(
        widgetTags.login,
        mergeProps(attrs, attributes, {
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
        }),
      );
    };
  },
});

export default ZitadelLogin as WithZitadelWidgetAttributes<typeof ZitadelLogin>;

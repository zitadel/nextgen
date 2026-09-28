import type { ZitadelProject } from "@zitadel/api/config";
import type { ZitadelLogin as ZitadelLoginElement } from "@zitadel/components";
import type {
  CreateFlowBodyPurpose,
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
} from "@zitadel/sdk-core/types";

import { defineComponent, h, type PropType, ref, toRaw } from "vue";
// Registers <zitadel-login> / <zitadel-logout> with the browser. Imported at
// module load (before render) so the element is upgraded by the time Vue
// patches it — which means Vue binds `project` as a DOM *property* (not a
// stringified attribute).
import "@zitadel/components";

/**
 * Vue wrapper for the `<zitadel-login>` Lit web component.
 *
 * Render-function form (string tag) so Vue never tries to resolve
 * `zitadel-login` as a Vue component — no `compilerOptions.isCustomElement`
 * needed. Supply the SDK handle from `configureZitadel(...)` as `:project`, or
 * the discrete `:project-id` / `:proxy-path` the widget reads instead — the
 * widget uses whichever is present. All three are bound as DOM properties and
 * read by the widget at startup. The widget's `zitadel-*` events are re-emitted
 * with their detail as `flowStep`, `flowInput`, `flowComplete` and
 * `flowError` (the names declared in `emits`).
 *
 * A Vue `ref` on this component resolves to the component *instance*, not the
 * inner element, so the rendered `<zitadel-login>` DOM node is exposed as
 * `element` (a `Ref` whose `.value` is the {@link ZitadelLoginElement}, or
 * `null` before mount). A consumer with `<ZitadelLogin ref="r" />` reads it via
 * `r.value.element`.
 */
export default defineComponent({
  name: "ZitadelLogin",
  props: {
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    projectId: { type: String, default: undefined },
    proxyPath: { type: String, default: undefined },
    purpose: {
      type: String as PropType<CreateFlowBodyPurpose>,
      default: "login",
    },
    postSignInUrl: { type: String, default: undefined },
    locales: {
      type: Object as PropType<Record<string, Partial<Record<string, string>>>>,
      default: undefined,
    },
    lang: { type: String, default: undefined },
    flowName: { type: String, default: undefined },
    variant: { type: String as PropType<"widget" | "page">, default: undefined },
    theme: { type: String as PropType<"light" | "dark" | "auto">, default: undefined },
    suppressHeader: { type: Boolean, default: undefined },
  },
  emits: ["flowStep", "flowInput", "flowComplete", "flowError"],
  setup(props, { emit, expose }) {
    // Template ref to the rendered Lit element. Exposed so a consumer's
    // component `ref` (which resolves to this instance) can reach the DOM node.
    const element = ref<ZitadelLoginElement | null>(null);
    expose({ element });

    return () =>
      h("zitadel-login", {
        ref: element,
        // Hand the Lit element the raw SDK handle, not Vue's reactive proxy:
        // the widget does identity checks on it (and `render` from test-utils
        // would otherwise pass a wrapped clone).
        project: toRaw(props.project),
        projectId: props.projectId,
        proxyPath: props.proxyPath,
        purpose: props.purpose,
        "post-sign-in-url": props.postSignInUrl,
        // Same raw-unwrap rationale as `project`: hand the widget the plain
        // dictionaries, not Vue's reactive proxy.
        locales: props.locales === undefined ? undefined : toRaw(props.locales),
        lang: props.lang,
        "flow-name": props.flowName,
        variant: props.variant,
        theme: props.theme,
        suppressHeader: props.suppressHeader,
        onZitadelFlowStep: (event: CustomEvent<ZitadelFlowStepDetail>) => {
          emit("flowStep", event.detail);
        },
        onZitadelFlowInput: (event: CustomEvent<ZitadelFlowInputDetail>) => {
          emit("flowInput", event.detail);
        },
        onZitadelFlowComplete: (event: CustomEvent<ZitadelFlowCompleteDetail>) => {
          emit("flowComplete", event.detail);
        },
        onZitadelFlowError: (event: CustomEvent<ZitadelFlowErrorDetail>) => {
          emit("flowError", event.detail);
        },
      });
  },
});

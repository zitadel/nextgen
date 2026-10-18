import type { ZitadelProject } from "@zitadel/api/config";
import type { ZitadelSession as ZitadelSessionElement } from "@zitadel/components";
import type { ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import { defineComponent, h, type PropType, ref, toRaw, watchEffect } from "vue";
import "@zitadel/components";
import { assignGiven } from "./given";

/**
 * Vue wrapper for the `<zitadel-session>` Lit web component — the post-sign-in
 * "signed in as" card. See {@link ZitadelLogin} for the rendering strategy.
 * Supply the SDK handle from `configureZitadel(...)` as `:project`, or the
 * discrete `:project-id` / `:proxy-path` the widget reads instead. The widget's
 * `zitadel-signout` event is re-emitted with its detail as `signout`.
 *
 * A Vue `ref` on this component resolves to the component *instance*; the
 * rendered `<zitadel-session>` DOM node is exposed as `element`.
 */
export default defineComponent({
  name: "ZitadelSession",
  props: {
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    projectId: { type: String, default: undefined },
    proxyPath: { type: String, default: undefined },
    postSignOutUrl: { type: String, default: undefined },
    heading: { type: String, default: undefined },
    logoutLabel: { type: String, default: undefined },
    variant: { type: String as PropType<"widget" | "page">, default: undefined },
    theme: { type: String as PropType<"light" | "dark" | "auto">, default: undefined },
    suppressHeader: { type: Boolean, default: undefined },
  },
  emits: ["signout"],
  setup(props, { emit, expose }) {
    const element = ref<ZitadelSessionElement | null>(null);
    expose({ element });

    // Props the element has defaults for are assigned only when given; a
    // binding would assign `undefined` and overwrite the default.
    watchEffect(
      () => {
        if (element.value) {
          assignGiven(element.value, {
            heading: props.heading,
            logoutLabel: props.logoutLabel,
            variant: props.variant,
            theme: props.theme,
            suppressHeader: props.suppressHeader,
          });
        }
      },
      { flush: "post" },
    );

    return () =>
      h("zitadel-session", {
        ref: element,
        // Hand the Lit element the raw SDK handle, not Vue's reactive proxy.
        project: toRaw(props.project),
        projectId: props.projectId,
        proxyPath: props.proxyPath,
        "post-sign-out-url": props.postSignOutUrl,
        onZitadelSignout: (event: CustomEvent<ZitadelSignoutDetail>) => {
          emit("signout", event.detail);
        },
      });
  },
});

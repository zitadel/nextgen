import type { ZitadelProject } from "@zitadel/api/config";
import type { ZitadelLogout as ZitadelLogoutElement } from "@zitadel/components";
import type { ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import { standardAttributes, widgetTags } from "@zitadel/sdk-core/types";
import { defineComponent, h, type PropType, ref, toRaw } from "vue";
import "@zitadel/components";

import type { WithZitadelWidgetAttributes } from "../types";
import { forceAttr } from "./forceAttr";

/**
 * Vue wrapper for the `<zitadel-logout>` Lit web component. See
 * {@link ZitadelLogin} for the rendering strategy. Supply the SDK handle from
 * `configureZitadel(...)` as `:project`, or the discrete `:project-id` /
 * `:proxy-path` the widget reads instead — the widget uses whichever is
 * present. The widget's `zitadel-signout` event is re-emitted with its detail
 * as `signout`.
 *
 * A Vue `ref` on this component resolves to the component *instance*, not the
 * inner element, so the rendered `<zitadel-logout>` DOM node is exposed as
 * `element` (a `Ref` whose `.value` is the {@link ZitadelLogoutElement}, or
 * `null` before mount). A consumer with `<ZitadelLogout ref="r" />` reads it via
 * `r.value.element`.
 */
const ZitadelLogout = defineComponent({
  name: "ZitadelLogout",
  // The element takes only the standard attributes (see below), never the rest of `attrs`.
  inheritAttrs: false,
  props: {
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    projectId: { type: String, default: undefined },
    proxyPath: { type: String, default: undefined },
    postSignOutUrl: { type: String, default: undefined },
    theme: { type: String as PropType<"light" | "dark" | "auto">, default: undefined },
  },
  emits: ["signout"],
  setup(props, { attrs, emit, expose }) {
    // Template ref to the rendered Lit element. Exposed so a consumer's
    // component `ref` (which resolves to this instance) can reach the DOM node.
    const element = ref<ZitadelLogoutElement | null>(null);
    expose({ element });

    return () => {
      // The standard HTML attributes are the only extra props the element takes.
      const attributes = standardAttributes(attrs);
      const attr = forceAttr();
      return h(widgetTags.logout, {
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
        "post-sign-out-url": props.postSignOutUrl,
        // A string prop with a default is bound as an attribute (the "^" prefix on
        // the client, see `forceAttr`): Vue assigns an unset property as "", which
        // the element cannot tell from an intended empty string, while an unset
        // attribute is simply removed.
        [`${attr}theme`]: props.theme,
        onZitadelSignout: (event: CustomEvent<ZitadelSignoutDetail>) => {
          emit("signout", event.detail);
        },
      });
    };
  },
});

export default ZitadelLogout as WithZitadelWidgetAttributes<typeof ZitadelLogout>;

import type { ZitadelProject } from "@zitadel/api/config";
import type { ZitadelSession as ZitadelSessionElement } from "@zitadel/components";
import type { ZitadelSessionErrorDetail, ZitadelSignoutDetail } from "@zitadel/sdk-core/types";

import { standardAttributes, widgetTags } from "@zitadel/sdk-core/types";
import { defineComponent, h, type PropType, ref, toRaw } from "vue";
import "@zitadel/components";

import type { WithZitadelWidgetAttributes } from "../types";
import { forceAttr } from "./forceAttr";

const Base = defineComponent({
  name: "ZitadelSession",
  // The element takes only the standard attributes (see below), never the rest of `attrs`.
  inheritAttrs: false,
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
  emits: ["signout", "sessionError"],
  setup(props, { attrs, emit, expose }) {
    const element = ref<ZitadelSessionElement | null>(null);
    expose({ element });

    return () => {
      // The standard HTML attributes are the only extra props the element takes.
      const attributes = standardAttributes(attrs);
      const attr = forceAttr();
      return h(widgetTags.session, {
        ...attributes,
        ref: element,
        // Hand the Lit element the raw SDK handle, not Vue's reactive proxy.
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
        [`${attr}heading`]: props.heading,
        [`${attr}logout-label`]: props.logoutLabel,
        [`${attr}variant`]: props.variant,
        [`${attr}theme`]: props.theme,
        suppressHeader: props.suppressHeader,
        onZitadelSignout: (event: CustomEvent<ZitadelSignoutDetail>) => {
          emit("signout", event.detail);
        },
        onZitadelSessionError: (event: CustomEvent<ZitadelSessionErrorDetail>) => {
          emit("sessionError", event.detail);
        },
      });
    };
  },
});

/**
 * Vue wrapper for the `<zitadel-session>` Lit web component — the post-sign-in
 * "signed in as" card. See {@link ZitadelLogin} for the rendering strategy.
 * Supply the SDK handle from `configureZitadel(...)` as `:project`, or the
 * discrete `:project-id` / `:proxy-path` the widget reads instead. The widget's
 * `zitadel-signout` event is re-emitted with its detail as `signout`, and `zitadel-session-error` as `sessionError`.
 *
 * A Vue `ref` on this component resolves to the component *instance*; the
 * rendered `<zitadel-session>` DOM node is exposed as `element`.
 */
const ZitadelSession: WithZitadelWidgetAttributes<typeof Base> = Base;

export default ZitadelSession;

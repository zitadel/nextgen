import type { ZitadelProject } from "@zitadel/api/config";
import type { ZitadelLogout as ZitadelLogoutElement } from "@zitadel/components";
import type {
  ZitadelSessionErrorDetail,
  ZitadelSessionMissingDetail,
  ZitadelSignoutDetail,
} from "@zitadel/sdk-core/types";

import { defineComponent, h, type PropType, ref, toRaw } from "vue";
import "@zitadel/components";

/**
 * Vue wrapper for the `<zitadel-logout>` Lit web component. See
 * {@link ZitadelLogin} for the rendering strategy. Supply the SDK handle from
 * `configureZitadel(...)` as `:project`, or the discrete `:project-id` /
 * `:proxy-path` the widget reads instead — the widget uses whichever is
 * present. The widget's `zitadel-signout` event is re-emitted with its detail
 * as `signout`, `zitadel-session-missing` as `sessionMissing`, and `zitadel-session-error` as
 * `sessionError`.
 *
 * A Vue `ref` on this component resolves to the component *instance*, not the
 * inner element, so the rendered `<zitadel-logout>` DOM node is exposed as
 * `element` (a `Ref` whose `.value` is the {@link ZitadelLogoutElement}, or
 * `null` before mount). A consumer with `<ZitadelLogout ref="r" />` reads it via
 * `r.value.element`.
 */
export default defineComponent({
  name: "ZitadelLogout",
  props: {
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    projectId: { type: String, default: undefined },
    proxyPath: { type: String, default: undefined },
    postSignOutUrl: { type: String, default: undefined },
    theme: { type: String as PropType<"light" | "dark" | "auto">, default: undefined },
  },
  emits: ["signout", "sessionMissing", "sessionError"],
  setup(props, { emit, expose, slots }) {
    // Template ref to the rendered Lit element. Exposed so a consumer's
    // component `ref` (which resolves to this instance) can reach the DOM node.
    const element = ref<ZitadelLogoutElement | null>(null);
    expose({ element });

    return () =>
      h(
        "zitadel-logout",
        {
          ref: element,
          // Hand the Lit element the raw SDK handle, not Vue's reactive proxy:
          // the widget does identity checks on it (and `render` from test-utils
          // would otherwise pass a wrapped clone).
          project: toRaw(props.project),
          projectId: props.projectId,
          proxyPath: props.proxyPath,
          "post-sign-out-url": props.postSignOutUrl,
          theme: props.theme,
          onZitadelSignout: (event: CustomEvent<ZitadelSignoutDetail>) => {
            emit("signout", event.detail);
          },
          onZitadelSessionMissing: (event: CustomEvent<ZitadelSessionMissingDetail>) => {
            emit("sessionMissing", event.detail);
          },
          onZitadelSessionError: (event: CustomEvent<ZitadelSessionErrorDetail>) => {
            emit("sessionError", event.detail);
          },
        },
        // Slot content goes into the element's light DOM: the `<template>`
        // `<zitadel-logout>` clones for a custom control, or login's
        // `attribution-trailing` slot.
        slots.default?.(),
      );
  },
});

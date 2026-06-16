import type { ZitadelProject } from '@zitadel/api/config';
import type { ZitadelSignoutDetail } from '@zitadel/sdk-core/types';

import { defineComponent, h, type PropType } from 'vue';
import '@zitadel/components';

/**
 * Vue wrapper for the `<zitadel-logout>` Lit web component. See
 * {@link ZitadelLogin} for the rendering strategy. Supply the SDK handle from
 * `configureZitadel(...)` as `:project`, or the discrete `:project-id` /
 * `:proxy-path` the widget reads instead — the widget uses whichever is
 * present. The widget's `zitadel-signout` event is re-emitted with its detail
 * as `signout`.
 */
export default defineComponent({
  name: 'ZitadelLogout',
  props: {
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    projectId: { type: String, default: undefined },
    proxyPath: { type: String, default: undefined },
    postSignOutUrl: { type: String, default: undefined },
  },
  emits: ['signout'],
  setup(props, { emit }) {
    return () =>
      h('zitadel-logout', {
        project: props.project,
        projectId: props.projectId,
        proxyPath: props.proxyPath,
        'post-sign-out-url': props.postSignOutUrl,
        onZitadelSignout: (event: CustomEvent<ZitadelSignoutDetail>) => {
          emit('signout', event.detail);
        },
      });
  },
});

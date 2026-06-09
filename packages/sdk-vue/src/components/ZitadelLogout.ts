import type { ZitadelProject } from '@zitadel/api/config';

import { defineComponent, h, type PropType } from 'vue';
import '@zitadel/components';

/**
 * Vue wrapper for the `<zitadel-logout>` Lit web component. See
 * {@link ZitadelLogin} for the rendering strategy. Pass the SDK handle from
 * `configureZitadel(...)` as `:project`.
 */
export default defineComponent({
  name: 'ZitadelLogout',
  props: {
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    postSignOutUrl: { type: String, default: undefined },
  },
  setup(props) {
    return () =>
      h('zitadel-logout', {
        project: props.project,
        'post-sign-out-url': props.postSignOutUrl,
      });
  },
});

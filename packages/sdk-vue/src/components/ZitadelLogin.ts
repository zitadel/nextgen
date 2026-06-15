import type { ZitadelProject } from '@zitadel/api/config';
import type {
  ZitadelFlowCompleteDetail,
  ZitadelFlowErrorDetail,
  ZitadelFlowInputDetail,
  ZitadelFlowStepDetail,
} from '@zitadel/sdk-core/types';

import { defineComponent, h, type PropType } from 'vue';
// Registers <zitadel-login> / <zitadel-logout> with the browser. Imported at
// module load (before render) so the element is upgraded by the time Vue
// patches it — which means Vue binds `project` as a DOM *property* (not a
// stringified attribute).
import '@zitadel/components';

/**
 * Vue wrapper for the `<zitadel-login>` Lit web component.
 *
 * Render-function form (string tag) so Vue never tries to resolve
 * `zitadel-login` as a Vue component — no `compilerOptions.isCustomElement`
 * needed. Pass the SDK handle from `configureZitadel(...)` as `:project`; it is
 * bound as a DOM property and read by the widget at startup. The widget's
 * `zitadel-*` events are re-emitted with their detail as `flow-step`,
 * `flow-input`, `flow-complete` and `flow-error`.
 */
export default defineComponent({
  name: 'ZitadelLogin',
  props: {
    project: { type: Object as PropType<ZitadelProject>, default: undefined },
    purpose: { type: String, default: 'login' },
    postSignInUrl: { type: String, default: undefined },
  },
  emits: ['flowStep', 'flowInput', 'flowComplete', 'flowError'],
  setup(props, { emit }) {
    return () =>
      h('zitadel-login', {
        project: props.project,
        purpose: props.purpose,
        'post-sign-in-url': props.postSignInUrl,
        onZitadelFlowStep: (event: CustomEvent<ZitadelFlowStepDetail>) => {
          emit('flowStep', event.detail);
        },
        onZitadelFlowInput: (event: CustomEvent<ZitadelFlowInputDetail>) => {
          emit('flowInput', event.detail);
        },
        onZitadelFlowComplete: (
          event: CustomEvent<ZitadelFlowCompleteDetail>,
        ) => {
          emit('flowComplete', event.detail);
        },
        onZitadelFlowError: (event: CustomEvent<ZitadelFlowErrorDetail>) => {
          emit('flowError', event.detail);
        },
      });
  },
});

<script lang="ts">
  import '@zitadel/components';
  import type { ZitadelProject } from '@zitadel/api/config';
  import type { ZitadelLogin as ZitadelLoginElement } from '@zitadel/components';

  import type {
    ZitadelFlowCompleteDetail,
    ZitadelFlowErrorDetail,
    ZitadelFlowInputDetail,
    ZitadelFlowStepDetail,
    ZitadelLoginProps,
  } from './types';

  let {
    project,
    projectId,
    proxyPath,
    purpose = 'login',
    postSignInUrl,
    onFlowStep,
    onFlowInput,
    onFlowComplete,
    onFlowError,
  }: ZitadelLoginProps = $props();

  let el: ZitadelLoginElement | undefined = $state();

  /**
   * Returns the underlying `<zitadel-login>` custom element, or `undefined`
   * before the component has mounted. Exposed as a component method, reachable
   * from a parent via `bind:this` — the Svelte 5 analogue of a React `ref`.
   */
  export function getElement(): ZitadelLoginElement | undefined {
    return el;
  }

  $effect(() => {
    if (!el) {
      return;
    }
    if (project !== undefined) {
      (el as unknown as { project?: ZitadelProject }).project = project;
    }
  });

  $effect(() => {
    if (!el) {
      return;
    }
    const step = (event: Event): void =>
      onFlowStep?.((event as CustomEvent<ZitadelFlowStepDetail>).detail);
    const input = (event: Event): void =>
      onFlowInput?.((event as CustomEvent<ZitadelFlowInputDetail>).detail);
    const complete = (event: Event): void =>
      onFlowComplete?.((event as CustomEvent<ZitadelFlowCompleteDetail>).detail);
    const error = (event: Event): void =>
      onFlowError?.((event as CustomEvent<ZitadelFlowErrorDetail>).detail);
    el.addEventListener('zitadel-flow-step', step);
    el.addEventListener('zitadel-flow-input', input);
    el.addEventListener('zitadel-flow-complete', complete);
    el.addEventListener('zitadel-flow-error', error);
    return () => {
      el?.removeEventListener('zitadel-flow-step', step);
      el?.removeEventListener('zitadel-flow-input', input);
      el?.removeEventListener('zitadel-flow-complete', complete);
      el?.removeEventListener('zitadel-flow-error', error);
    };
  });
</script>

<zitadel-login
  bind:this={el}
  {purpose}
  project-id={projectId}
  proxy-path={proxyPath}
  post-sign-in-url={postSignInUrl}
></zitadel-login>

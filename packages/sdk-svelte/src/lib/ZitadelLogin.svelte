<script lang="ts">
  import '@zitadel/components'; // registers <zitadel-login>
  import type { ZitadelProject } from '@zitadel/api/config';

  import type {
    ZitadelFlowCompleteDetail,
    ZitadelFlowErrorDetail,
    ZitadelFlowInputDetail,
    ZitadelFlowStepDetail,
  } from './types';

  let {
    project,
    purpose = 'login',
    postSignInUrl,
    onFlowStep,
    onFlowInput,
    onFlowComplete,
    onFlowError,
  }: {
    project: ZitadelProject;
    purpose?: string;
    postSignInUrl?: string;
    onFlowStep?: (detail: ZitadelFlowStepDetail) => void;
    onFlowInput?: (detail: ZitadelFlowInputDetail) => void;
    onFlowComplete?: (detail: ZitadelFlowCompleteDetail) => void;
    onFlowError?: (detail: ZitadelFlowErrorDetail) => void;
  } = $props();

  let el: HTMLElement | undefined = $state();

  // object handle → DOM property (timing-proof, set after mount)
  $effect(() => {
    if (el) (el as unknown as { project?: ZitadelProject }).project = project;
  });

  // zitadel-* custom events → optional callbacks, with cleanup
  $effect(() => {
    if (!el) return;
    const step = (e: Event) => onFlowStep?.((e as CustomEvent<ZitadelFlowStepDetail>).detail);
    const input = (e: Event) => onFlowInput?.((e as CustomEvent<ZitadelFlowInputDetail>).detail);
    const done = (e: Event) => onFlowComplete?.((e as CustomEvent<ZitadelFlowCompleteDetail>).detail);
    const err = (e: Event) => onFlowError?.((e as CustomEvent<ZitadelFlowErrorDetail>).detail);
    el.addEventListener('zitadel-flow-step', step);
    el.addEventListener('zitadel-flow-input', input);
    el.addEventListener('zitadel-flow-complete', done);
    el.addEventListener('zitadel-flow-error', err);
    return () => {
      el?.removeEventListener('zitadel-flow-step', step);
      el?.removeEventListener('zitadel-flow-input', input);
      el?.removeEventListener('zitadel-flow-complete', done);
      el?.removeEventListener('zitadel-flow-error', err);
    };
  });
</script>

<zitadel-login bind:this={el} {purpose} post-sign-in-url={postSignInUrl}></zitadel-login>

<script lang="ts">
  import '@zitadel/components'; // registers <zitadel-login>
  import type { ZitadelProject } from '@zitadel/api/config';

  let {
    project,
    purpose = 'login',
    postSignInUrl,
    onFlowStep,
    onFlowComplete,
    onFlowError,
  }: {
    project: ZitadelProject;
    purpose?: string;
    postSignInUrl?: string;
    onFlowStep?: (detail: unknown) => void;
    onFlowComplete?: (detail: unknown) => void;
    onFlowError?: (detail: unknown) => void;
  } = $props();

  let el: HTMLElement | undefined = $state();

  // object handle → DOM property (timing-proof, set after mount)
  $effect(() => {
    if (el) (el as unknown as { project?: ZitadelProject }).project = project;
  });

  // zitadel-flow-* custom events → optional callbacks, with cleanup
  $effect(() => {
    if (!el) return;
    const step = (e: Event) => onFlowStep?.((e as CustomEvent).detail);
    const done = (e: Event) => onFlowComplete?.((e as CustomEvent).detail);
    const err = (e: Event) => onFlowError?.((e as CustomEvent).detail);
    el.addEventListener('zitadel-flow-step', step);
    el.addEventListener('zitadel-flow-complete', done);
    el.addEventListener('zitadel-flow-error', err);
    return () => {
      el?.removeEventListener('zitadel-flow-step', step);
      el?.removeEventListener('zitadel-flow-complete', done);
      el?.removeEventListener('zitadel-flow-error', err);
    };
  });
</script>

<zitadel-login bind:this={el} {purpose} post-sign-in-url={postSignInUrl}></zitadel-login>

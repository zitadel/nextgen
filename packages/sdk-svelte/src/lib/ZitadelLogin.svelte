<script lang="ts">
  import '@zitadel/components';
  import type { ZitadelProject } from '@zitadel/api/config';

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

  let el: HTMLElement | undefined = $state();

  $effect(() => {
    if (!el) {
      return;
    }
    const target = el as unknown as {
      project?: ZitadelProject;
      projectId?: string;
      proxyPath?: string;
    };
    if (project !== undefined) {
      target.project = project;
    }
    if (projectId !== undefined) {
      target.projectId = projectId;
    }
    if (proxyPath !== undefined) {
      target.proxyPath = proxyPath;
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

<zitadel-login bind:this={el} {purpose} post-sign-in-url={postSignInUrl}></zitadel-login>

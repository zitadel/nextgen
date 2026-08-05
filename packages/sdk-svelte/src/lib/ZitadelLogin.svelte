<script lang="ts">
  import '@zitadel/components';
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
    flowName,
    postSignInUrl,
    locales,
    lang,
    variant,
    theme,
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
    const node = el;
    if (!node) {
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
    node.addEventListener('zitadel-flow-step', step);
    node.addEventListener('zitadel-flow-input', input);
    node.addEventListener('zitadel-flow-complete', complete);
    node.addEventListener('zitadel-flow-error', error);
    return () => {
      node.removeEventListener('zitadel-flow-step', step);
      node.removeEventListener('zitadel-flow-input', input);
      node.removeEventListener('zitadel-flow-complete', complete);
      node.removeEventListener('zitadel-flow-error', error);
    };
  });
</script>

<zitadel-login
  bind:this={el}
  {project}
  {purpose}
  {locales}
  {lang}
  project-id={projectId}
  proxy-path={proxyPath}
  post-sign-in-url={postSignInUrl}
  flow-name={flowName}
  variant={variant}
  theme={theme}
></zitadel-login>

<script lang="ts">
  import '@zitadel/components';
  import { standardAttributes } from '@zitadel/sdk-core/types';
  import type { ZitadelLogin as ZitadelLoginElement } from '@zitadel/components';

  import type { ZitadelLoginSvelteProps } from './types.js';
  import { assignGiven } from './given.js';
  import { withDetail } from './events.js';
  import { onClient, proxyPathAttr } from './attributes.js';

  let {
    project,
    projectId,
    proxyPath,
    purpose = 'login',
    flowName,
    postSignInUrl,
    forcePostSignInUrl,
    resumeFlowId,
    locales,
    lang,
    variant,
    theme,
    suppressHeader,
    suppressPasswordToggle,
    onFlowStep,
    onFlowInput,
    onFlowComplete,
    onFlowRedirect,
    onFlowError,
    ...rest
  }: ZitadelLoginSvelteProps = $props();

  // The standard HTML attributes are the only extra props the element takes.
  const attributes = $derived(standardAttributes(rest));

  let el: ZitadelLoginElement | undefined = $state();

  /**
   * Returns the underlying `<zitadel-login>` custom element, or `undefined`
   * before the component has mounted. Exposed as a component method, reachable
   * from a parent via `bind:this` — the Svelte 5 analogue of a React `ref`.
   */
  export function getElement(): ZitadelLoginElement | undefined {
    return el;
  }

  // Props the element has defaults for are assigned only when given; a
  // binding would assign `undefined` and overwrite the default.
  $effect(() => {
    if (el) {
      assignGiven(el, {
        lang,
        variant,
        theme,
        suppressHeader,
        suppressPasswordToggle,
        forcePostSignInUrl,
      });
    }
  });

  $effect(() => {
    const node = el;
    if (!node) {
      return;
    }
    const step = (event: Event): void => {
      withDetail(event, onFlowStep);
    };
    const input = (event: Event): void => {
      withDetail(event, onFlowInput);
    };
    const complete = (event: Event): void => {
      withDetail(event, onFlowComplete);
    };
    const redirect = (event: Event): void => {
      withDetail(event, onFlowRedirect);
    };
    const error = (event: Event): void => {
      withDetail(event, onFlowError);
    };
    node.addEventListener('zitadel-flow-step', step);
    node.addEventListener('zitadel-flow-input', input);
    node.addEventListener('zitadel-flow-complete', complete);
    node.addEventListener('zitadel-flow-redirect', redirect);
    node.addEventListener('zitadel-flow-error', error);
    return () => {
      node.removeEventListener('zitadel-flow-step', step);
      node.removeEventListener('zitadel-flow-input', input);
      node.removeEventListener('zitadel-flow-complete', complete);
      node.removeEventListener('zitadel-flow-redirect', redirect);
      node.removeEventListener('zitadel-flow-error', error);
    };
  });
</script>

<zitadel-login
  {...attributes}
  bind:this={el}
  project={onClient(project)}
  {purpose}
  {locales}
  project-id={project?.projectId ?? projectId}
  proxy-path={proxyPathAttr(project?.proxyPath ?? proxyPath)}
  url={project?.url}
  post-sign-in-url={postSignInUrl}
  resume-flow-id={resumeFlowId}
  flow-name={flowName}
></zitadel-login>

<script lang="ts">
  import '@zitadel/components';
  import type { ZitadelSession as ZitadelSessionElement } from '@zitadel/components';

  import type { ZitadelSessionProps, ZitadelContinueDetail, ZitadelSignoutDetail } from './types';

  let {
    project,
    projectId,
    proxyPath,
    continueUrl,
    postSignOutUrl,
    heading,
    continueLabel,
    logoutLabel,
    onContinue,
    onSignout,
  }: ZitadelSessionProps = $props();

  let el: ZitadelSessionElement | undefined = $state();

  /**
   * Returns the underlying `<zitadel-session>` custom element, or `undefined`
   * before the component has mounted. Exposed as a component method, reachable
   * from a parent via `bind:this` — the Svelte 5 analogue of a React `ref`.
   */
  export function getElement(): ZitadelSessionElement | undefined {
    return el;
  }

  $effect(() => {
    const node = el;
    if (!node) {
      return;
    }
    const onContinueEvent = (event: Event): void =>
      onContinue?.((event as CustomEvent<ZitadelContinueDetail>).detail);
    const onSignoutEvent = (event: Event): void =>
      onSignout?.((event as CustomEvent<ZitadelSignoutDetail>).detail);
    node.addEventListener('zitadel-continue', onContinueEvent);
    node.addEventListener('zitadel-signout', onSignoutEvent);
    return () => {
      node.removeEventListener('zitadel-continue', onContinueEvent);
      node.removeEventListener('zitadel-signout', onSignoutEvent);
    };
  });
</script>

<zitadel-session
  bind:this={el}
  {project}
  project-id={projectId}
  proxy-path={proxyPath}
  continue-url={continueUrl}
  post-sign-out-url={postSignOutUrl}
  {heading}
  continue-label={continueLabel}
  logout-label={logoutLabel}
></zitadel-session>

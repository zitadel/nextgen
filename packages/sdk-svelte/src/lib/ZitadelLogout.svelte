<script lang="ts">
  import '@zitadel/components';
  import { standardAttributes } from '@zitadel/sdk-core/types';
  import type { ZitadelLogout as ZitadelLogoutElement } from '@zitadel/components';

  import type { ZitadelLogoutSvelteProps } from './types';
  import { assignGiven } from './given';
  import { onClient, proxyPathAttr } from './attributes';

  let {
    project,
    projectId,
    proxyPath,
    postSignOutUrl,
    theme,
    onSignout,
    onSessionError,
    ...rest
  }: ZitadelLogoutSvelteProps = $props();

  // The standard HTML attributes are the only extra props the element takes.
  const attributes = $derived(standardAttributes(rest));

  let el: ZitadelLogoutElement | undefined = $state();

  /**
   * Returns the underlying `<zitadel-logout>` custom element, or `undefined`
   * before the component has mounted. Exposed as a component method, reachable
   * from a parent via `bind:this` — the Svelte 5 analogue of a React `ref`.
   */
  export function getElement(): ZitadelLogoutElement | undefined {
    return el;
  }

  // Props the element has defaults for are assigned only when given; a
  // binding would assign `undefined` and overwrite the default.
  $effect(() => {
    if (el) {
      assignGiven(el, { theme });
    }
  });

  $effect(() => {
    const node = el;
    if (!node) {
      return;
    }
    const signout = (event: Event): void => {
      if (event instanceof CustomEvent) onSignout?.(event.detail);
    };
    const sessionError = (event: Event): void => {
      if (event instanceof CustomEvent) onSessionError?.(event.detail);
    };
    node.addEventListener('zitadel-signout', signout);
    node.addEventListener('zitadel-session-error', sessionError);
    return () => {
      node.removeEventListener('zitadel-signout', signout);
      node.removeEventListener('zitadel-session-error', sessionError);
    };
  });
</script>

<zitadel-logout
  {...attributes}
  bind:this={el}
  project={onClient(project)}
  project-id={project?.projectId ?? projectId}
  proxy-path={proxyPathAttr(project?.proxyPath ?? proxyPath)}
  url={project?.url}
  post-sign-out-url={postSignOutUrl}
></zitadel-logout>

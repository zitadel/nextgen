<script lang="ts">
  import '@zitadel/components';
  import type { ZitadelLogout as ZitadelLogoutElement } from '@zitadel/components';

  import type { ZitadelLogoutProps, ZitadelSessionErrorDetail, ZitadelSignoutDetail } from './types';
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
  }: ZitadelLogoutProps = $props();

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
  // The listeners below are element attributes, bound when the element is created and
  // before the widget can start loading; an `$effect` runs only after mount and would
  // miss a failure the widget raises as it mounts. The handlers read the props when the
  // event fires, so they stay current.
</script>

<zitadel-logout
  bind:this={el}
  onzitadel-signout={(event) =>
    onSignout?.((event as CustomEvent<ZitadelSignoutDetail>).detail)}
  onzitadel-session-error={(event) =>
    onSessionError?.((event as CustomEvent<ZitadelSessionErrorDetail>).detail)}
  project={onClient(project)}
  project-id={project?.projectId ?? projectId}
  proxy-path={proxyPathAttr(project?.proxyPath ?? proxyPath)}
  url={project?.url}
  post-sign-out-url={postSignOutUrl}
></zitadel-logout>

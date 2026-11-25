<script lang="ts">
  import '@zitadel/components';
  import { standardAttributes } from '@zitadel/sdk-core/types';
  import type { ZitadelSession as ZitadelSessionElement } from '@zitadel/components';

  import type { ZitadelSessionSvelteProps } from './types';
  import { assignGiven } from './given';
  import { withDetail } from './events';
  import { onClient, proxyPathAttr } from './attributes';

  let {
    project,
    projectId,
    proxyPath,
    postSignOutUrl,
    heading,
    logoutLabel,
    variant,
    theme,
    suppressHeader,
    onSignout,
    ...rest
  }: ZitadelSessionSvelteProps = $props();

  // The standard HTML attributes are the only extra props the element takes.
  const attributes = $derived(standardAttributes(rest));

  let el: ZitadelSessionElement | undefined = $state();

  /**
   * Returns the underlying `<zitadel-session>` custom element, or `undefined`
   * before the component has mounted. Exposed as a component method, reachable
   * from a parent via `bind:this` — the Svelte 5 analogue of a React `ref`.
   */
  export function getElement(): ZitadelSessionElement | undefined {
    return el;
  }

  // Props the element has defaults for are assigned only when given; a
  // binding would assign `undefined` and overwrite the default.
  $effect(() => {
    if (el) {
      assignGiven(el, { heading, logoutLabel, variant, theme, suppressHeader });
    }
  });

  $effect(() => {
    const node = el;
    if (!node) {
      return;
    }
    const onSignoutEvent = (event: Event): void => {
      withDetail(event, onSignout);
    };
    node.addEventListener('zitadel-signout', onSignoutEvent);
    return () => {
      node.removeEventListener('zitadel-signout', onSignoutEvent);
    };
  });
</script>

<zitadel-session
  {...attributes}
  bind:this={el}
  project={onClient(project)}
  project-id={project?.projectId ?? projectId}
  proxy-path={proxyPathAttr(project?.proxyPath ?? proxyPath)}
  url={project?.url}
  post-sign-out-url={postSignOutUrl}
></zitadel-session>

<!--
  @component
  Renders the signed-in session card as a `<zitadel-session>` custom element.

  The card shows who is signed in and a sign-out action. Optional props
  (`heading`, `logoutLabel`, `variant`, `theme`, `suppressHeader`) are assigned
  only when set, so an unset prop keeps the element's own default instead of
  blanking it. `projectId` and `proxyPath` are written as the `project-id` and
  `proxy-path` attributes for server markup, and `onSignout` receives the
  element's `zitadel-signout` event.

  Use it to show the current user. Props are typed by
  {@link ZitadelSessionSvelteProps}. `getElement()` returns the underlying
  element, or `undefined` before mount, via `bind:this`.

  @example
  <ZitadelSession {project} postSignOutUrl="/login" />
-->

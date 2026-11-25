<script lang="ts">
  import '@zitadel/components';
  import { standardAttributes } from '@zitadel/sdk-core/types';
  import type { ZitadelLogin as ZitadelLoginElement } from '@zitadel/components';

  import type { ZitadelLoginSvelteProps } from './types';
  import { assignGiven } from './given';
  import { withDetail } from './events';
  import { onClient, proxyPathAttr } from './attributes';

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

<!--
  @component
  Renders the Zitadel sign-in flow as a `<zitadel-login>` custom element.

  The wrapper is compiled by your app's Svelte build, which is why the package
  ships its source through the `svelte` export condition. It writes `projectId`
  and `proxyPath` as the `project-id` and `proxy-path` attributes so server
  markup already carries the configuration, and assigns the `project` handle as
  a property once the browser runs. Optional widget props (`variant`, `theme`,
  `lang`, `suppressHeader`, `suppressPasswordToggle`, `forcePostSignInUrl`) are
  assigned only when set, so an unset prop keeps the element's own default. The
  `onFlow*` callbacks are forwarded from the element's events; a promise a
  callback returns delays navigation for up to two seconds.

  Use it on the page that signs a visitor in. Props are typed by
  {@link ZitadelLoginSvelteProps}. `getElement()` returns the underlying
  element, or `undefined` before mount, via `bind:this`.

  @example
  <ZitadelLogin {project} purpose="login" postSignInUrl="/" />
-->

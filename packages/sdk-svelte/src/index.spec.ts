// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ZitadelLogin from './lib/ZitadelLogin.svelte';
import ZitadelLogout from './lib/ZitadelLogout.svelte';

const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('no network'))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('ZitadelLogin', () => {
  it('renders a <zitadel-login> element and forwards the project prop', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ZitadelLogin, {
      target,
      props: { project, purpose: 'login' },
    });
    flushSync();
    const el = target.querySelector('zitadel-login') as
      | (HTMLElement & { project?: unknown })
      | null;
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
    unmount(component);
  });

  it('forwards the zitadel-flow-error event detail to onFlowError', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onFlowError = vi.fn();
    const component = mount(ZitadelLogin, {
      target,
      props: { project, purpose: 'login', onFlowError },
    });
    flushSync();
    const el = target.querySelector('zitadel-login') as HTMLElement | null;
    expect(el).not.toBeNull();
    const detail = { message: 'boom' };
    el!.dispatchEvent(new CustomEvent('zitadel-flow-error', { detail }));
    expect(onFlowError).toHaveBeenCalledTimes(1);
    expect(onFlowError).toHaveBeenCalledWith(detail);
    unmount(component);
  });
});

describe('ZitadelLogout', () => {
  it('renders a <zitadel-logout> element and forwards the project prop', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ZitadelLogout, { target, props: { project } });
    flushSync();
    const el = target.querySelector('zitadel-logout') as
      | (HTMLElement & { project?: unknown })
      | null;
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
    unmount(component);
  });

  it('forwards the zitadel-signout event detail to onSignout', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onSignout = vi.fn();
    const component = mount(ZitadelLogout, {
      target,
      props: { project, onSignout },
    });
    flushSync();
    const el = target.querySelector('zitadel-logout') as HTMLElement | null;
    expect(el).not.toBeNull();
    const detail = { name: 'Ada', email: 'ada@example.com' };
    el!.dispatchEvent(new CustomEvent('zitadel-signout', { detail }));
    expect(onSignout).toHaveBeenCalledTimes(1);
    expect(onSignout).toHaveBeenCalledWith(detail);
    unmount(component);
  });
});

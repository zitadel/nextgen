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
});

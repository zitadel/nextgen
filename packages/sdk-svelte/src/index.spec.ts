// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ZitadelLogin from './lib/ZitadelLogin.svelte';
import ZitadelLogout from './lib/ZitadelLogout.svelte';

const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

type ConfiguredElement = HTMLElement & {
  project?: unknown;
  projectId?: string;
  proxyPath?: string;
};

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
  it('binds the project handle as a property', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ZitadelLogin, {
      target,
      props: { project, purpose: 'login' },
    });
    flushSync();
    const el = target.querySelector<ConfiguredElement>('zitadel-login');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
    unmount(component);
  });

  it('binds discrete projectId/proxyPath', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ZitadelLogin, {
      target,
      props: { projectId: 'proj-test', proxyPath: '/__nextgen' },
    });
    flushSync();
    const el = target.querySelector<ConfiguredElement>('zitadel-login');
    expect(el).not.toBeNull();
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
    unmount(component);
  });

  it('forwards zitadel-flow-step as onFlowStep(detail)', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const onFlowStep = vi.fn();
    const component = mount(ZitadelLogin, {
      target,
      props: { project, purpose: 'login', onFlowStep },
    });
    flushSync();
    const el = target.querySelector('zitadel-login') as HTMLElement | null;
    expect(el).not.toBeNull();
    const detail = { step: { kind: 'register' } };
    el!.dispatchEvent(new CustomEvent('zitadel-flow-step', { detail }));
    expect(onFlowStep).toHaveBeenCalledWith(detail);
    unmount(component);
  });
});

describe('ZitadelLogout', () => {
  it('binds the project handle as a property', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ZitadelLogout, { target, props: { project } });
    flushSync();
    const el = target.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
    unmount(component);
  });

  it('binds discrete projectId/proxyPath', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const component = mount(ZitadelLogout, {
      target,
      props: { projectId: 'proj-test', proxyPath: '/__nextgen' },
    });
    flushSync();
    const el = target.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
    unmount(component);
  });

  it('forwards zitadel-signout as onSignout(detail)', () => {
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
    expect(onSignout).toHaveBeenCalledWith(detail);
    unmount(component);
  });
});

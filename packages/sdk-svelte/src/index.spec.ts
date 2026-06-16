// @vitest-environment jsdom
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
} from '@zitadel/sdk-core/types';
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
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
    unmount(component);
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    'forwards %s to its callback',
    (eventName, handlerProp) => {
      const target = document.createElement('div');
      document.body.appendChild(target);
      const spy = vi.fn();
      const component = mount(ZitadelLogin, {
        target,
        props: { project, [handlerProp]: spy },
      });
      flushSync();
      const el = target.querySelector('zitadel-login');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
      unmount(component);
    },
  );
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
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
    unmount(component);
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    'forwards %s to its callback',
    (eventName, handlerProp) => {
      const target = document.createElement('div');
      document.body.appendChild(target);
      const spy = vi.fn();
      const component = mount(ZitadelLogout, {
        target,
        props: { project, [handlerProp]: spy },
      });
      flushSync();
      const el = target.querySelector('zitadel-logout');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
      unmount(component);
    },
  );
});

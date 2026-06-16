// @vitest-environment jsdom
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
} from '@zitadel/sdk-core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, type Component } from 'vue';

import ZitadelLogin from './components/ZitadelLogin';
import ZitadelLogout from './components/ZitadelLogout';

const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

// `'zitadel-flow-step'` → `'flowStep'`: the camelCased emit name Vue exposes.
const emitName = (event: string): string =>
  event
    .replace(/^zitadel-/, '')
    .replace(/-([a-z])/g, (_, c) => c.toUpperCase());

// `'zitadel-flow-step'` → `'onFlowStep'`: the prop key that subscribes to that
// emit when passed to `h(component, props)`.
const listenerProp = (event: string): string => {
  const name = emitName(event);
  return 'on' + name.charAt(0).toUpperCase() + name.slice(1);
};

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

function mount(
  component: Component,
  props: Record<string, unknown>,
): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  createApp({ render: () => h(component, props) }).mount(host);
  return host;
}

describe('ZitadelLogin', () => {
  it('binds the project handle as a property', () => {
    const host = mount(ZitadelLogin, { project, purpose: 'login' });
    const el = host.querySelector<ConfiguredElement>('zitadel-login');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const host = mount(ZitadelLogin, {
      projectId: 'proj-test',
      proxyPath: '/__nextgen',
    });
    const el = host.querySelector<ConfiguredElement>('zitadel-login');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.keys(ZITADEL_LOGIN_EVENT_HANDLERS))(
    're-emits %s with its detail',
    (eventName) => {
      const spy = vi.fn();
      const host = mount(ZitadelLogin, {
        project,
        [listenerProp(eventName)]: spy,
      });
      const el = host.querySelector('zitadel-login');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );
});

describe('ZitadelLogout', () => {
  it('binds the project handle as a property', () => {
    const host = mount(ZitadelLogout, { project });
    const el = host.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const host = mount(ZitadelLogout, {
      projectId: 'proj-test',
      proxyPath: '/__nextgen',
    });
    const el = host.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.keys(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    're-emits %s with its detail',
    (eventName) => {
      const spy = vi.fn();
      const host = mount(ZitadelLogout, {
        project,
        [listenerProp(eventName)]: spy,
      });
      const el = host.querySelector('zitadel-logout');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );
});

// @vitest-environment jsdom
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
} from '@zitadel/sdk-core/types';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ZitadelLogin, ZitadelLogout } from './index';

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

function mount(node: () => unknown): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  render(node as () => never, host);
  return host;
}

describe('ZitadelLogin', () => {
  it('binds the project handle as a property', () => {
    const host = mount(() => (
      <ZitadelLogin project={project} purpose="login" />
    ));
    const el = host.querySelector<ConfiguredElement>('zitadel-login');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const host = mount(() => (
      <ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />
    ));
    const el = host.querySelector<ConfiguredElement>('zitadel-login');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    'forwards %s to its callback',
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const host = mount(() => (
        <ZitadelLogin project={project} {...{ [handlerProp]: spy }} />
      ));
      const el = host.querySelector('zitadel-login');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );
});

describe('ZitadelLogout', () => {
  it('binds the project handle as a property', () => {
    const host = mount(() => <ZitadelLogout project={project} />);
    const el = host.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const host = mount(() => (
      <ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" />
    ));
    const el = host.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    'forwards %s to its callback',
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const host = mount(() => (
        <ZitadelLogout project={project} {...{ [handlerProp]: spy }} />
      ));
      const el = host.querySelector('zitadel-logout');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );
});

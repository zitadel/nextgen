// @vitest-environment jsdom
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
} from '@zitadel/components';

import { cleanup, render } from '@testing-library/svelte';
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
} from '@zitadel/sdk-core/types';
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
  cleanup();
  vi.unstubAllGlobals();
});

describe('ZitadelLogin', () => {
  it('binds the project handle as a property', () => {
    const { container } = render(ZitadelLogin, {
      props: { project, purpose: 'login' },
    });
    const el = container.querySelector<ZitadelLoginElement>('zitadel-login');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const { container } = render(ZitadelLogin, {
      props: { projectId: 'proj-test', proxyPath: '/__nextgen' },
    });
    const el = container.querySelector<ZitadelLoginElement>('zitadel-login');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    'forwards %s to its callback',
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(ZitadelLogin, {
        props: { project, [handlerProp]: spy },
      });
      const el = container.querySelector('zitadel-login');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );
});

describe('ZitadelLogout', () => {
  it('binds the project handle as a property', () => {
    const { container } = render(ZitadelLogout, { props: { project } });
    const el = container.querySelector<ZitadelLogoutElement>('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const { container } = render(ZitadelLogout, {
      props: { projectId: 'proj-test', proxyPath: '/__nextgen' },
    });
    const el = container.querySelector<ZitadelLogoutElement>('zitadel-logout');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    'forwards %s to its callback',
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(ZitadelLogout, {
        props: { project, [handlerProp]: spy },
      });
      const el = container.querySelector('zitadel-logout');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );
});

// @vitest-environment jsdom
import { $, render } from '@builder.io/qwik';
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
} from '@zitadel/sdk-core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@zitadel/components';

import { ZitadelLogin, ZitadelLogout } from './index';

const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

type ConfiguredElement = HTMLElement & {
  project?: unknown;
  projectId?: string;
  proxyPath?: string;
};

// Qwik wires the widget's listeners in a useVisibleTask$, which runs a turn after
// render; await a tick so the listeners exist before the event is dispatched.
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 20));

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
  it('binds the project handle as a property', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await render(host, <ZitadelLogin project={project} purpose="login" />);
    const el = host.querySelector<ConfiguredElement>('zitadel-login');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await render(
      host,
      <ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />,
    );
    const el = host.querySelector<ConfiguredElement>('zitadel-login');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    'forwards %s to its callback',
    async (eventName, handlerProp) => {
      const received: Record<string, unknown>[] = [];
      const host = document.createElement('div');
      document.body.appendChild(host);
      await render(
        host,
        <ZitadelLogin
          project={project}
          {...{
            [`${handlerProp}$`]: $((detail: Record<string, unknown>) => {
              received.push(detail);
            }),
          }}
        />,
      );
      await tick();
      const el = host.querySelector('zitadel-login');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      await tick();
      expect(received).toEqual([detail]);
    },
  );
});

describe('ZitadelLogout', () => {
  it('binds the project handle as a property', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await render(host, <ZitadelLogout project={project} />);
    const el = host.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await render(
      host,
      <ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" />,
    );
    const el = host.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    'forwards %s to its callback',
    async (eventName, handlerProp) => {
      const received: Record<string, unknown>[] = [];
      const host = document.createElement('div');
      document.body.appendChild(host);
      await render(
        host,
        <ZitadelLogout
          project={project}
          {...{
            [`${handlerProp}$`]: $((detail: Record<string, unknown>) => {
              received.push(detail);
            }),
          }}
        />,
      );
      await tick();
      const el = host.querySelector('zitadel-logout');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      await tick();
      expect(received).toEqual([detail]);
    },
  );
});

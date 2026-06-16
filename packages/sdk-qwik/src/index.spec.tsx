// @vitest-environment jsdom
import { $, render } from '@builder.io/qwik';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@zitadel/components';

import type { ZitadelFlowStepDetail, ZitadelSignoutDetail } from './types';

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

  it('forwards zitadel-flow-step as onFlowStep$(detail)', async () => {
    const received: ZitadelFlowStepDetail[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    await render(
      host,
      <ZitadelLogin
        project={project}
        onFlowStep$={$((detail) => {
          received.push(detail);
        })}
      />,
    );
    await tick();
    const el = host.querySelector('zitadel-login');
    const detail = { step: { kind: 'register' } };
    el?.dispatchEvent(new CustomEvent('zitadel-flow-step', { detail }));
    await tick();
    expect(received).toEqual([detail]);
  });
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

  it('forwards zitadel-signout as onSignout$(detail)', async () => {
    const received: ZitadelSignoutDetail[] = [];
    const host = document.createElement('div');
    document.body.appendChild(host);
    await render(
      host,
      <ZitadelLogout
        project={project}
        onSignout$={$((detail) => {
          received.push(detail);
        })}
      />,
    );
    await tick();
    const el = host.querySelector('zitadel-logout');
    const detail = { name: 'Ada', email: 'ada@example.com' };
    el?.dispatchEvent(new CustomEvent('zitadel-signout', { detail }));
    await tick();
    expect(received).toEqual([detail]);
  });
});

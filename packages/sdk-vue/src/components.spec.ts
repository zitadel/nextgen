// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, type Component } from 'vue';

import ZitadelLogin from './components/ZitadelLogin';
import ZitadelLogout from './components/ZitadelLogout';

const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

type ConfiguredElement = HTMLElement & {
  project?: unknown;
  projectId?: string;
  proxyPath?: string;
};

beforeEach(() => {
  // The widget starts a flow on mount; stub fetch so the attempt fails quietly.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('no network'))),
  );
});

afterEach(() => {
  // Restore the real fetch and drop mounted nodes so tests stay isolated.
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

  it('forwards zitadel-flow-step as onFlowStep(detail)', () => {
    const onFlowStep = vi.fn();
    const host = mount(ZitadelLogin, { project, onFlowStep });
    const el = host.querySelector('zitadel-login');
    const detail = { step: { kind: 'register' } };
    el?.dispatchEvent(new CustomEvent('zitadel-flow-step', { detail }));
    expect(onFlowStep).toHaveBeenCalledWith(detail);
  });
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

  it('forwards zitadel-signout as onSignout(detail)', () => {
    const onSignout = vi.fn();
    const host = mount(ZitadelLogout, { project, onSignout });
    const el = host.querySelector('zitadel-logout');
    const detail = { name: 'Ada', email: 'ada@example.com' };
    el?.dispatchEvent(new CustomEvent('zitadel-signout', { detail }));
    expect(onSignout).toHaveBeenCalledWith(detail);
  });
});

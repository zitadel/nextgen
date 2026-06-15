// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, h, type Component } from 'vue';

import ZitadelLogin from './components/ZitadelLogin';
import ZitadelLogout from './components/ZitadelLogout';

const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

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
  it('renders a <zitadel-login> element and forwards the project prop', () => {
    const host = mount(ZitadelLogin, { project, purpose: 'login' });
    const el = host.querySelector('zitadel-login') as
      | (HTMLElement & { project?: unknown })
      | null;
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('re-emits zitadel-flow-step as flowStep(detail)', () => {
    const onFlowStep = vi.fn();
    const host = mount(ZitadelLogin, { project, onFlowStep });
    const el = host.querySelector('zitadel-login');
    const detail = { step: { kind: 'register' } };
    el?.dispatchEvent(new CustomEvent('zitadel-flow-step', { detail }));
    expect(onFlowStep).toHaveBeenCalledWith(detail);
  });
});

describe('ZitadelLogout', () => {
  it('renders a <zitadel-logout> element and forwards the project prop', () => {
    const host = mount(ZitadelLogout, { project });
    const el = host.querySelector('zitadel-logout') as
      | (HTMLElement & { project?: unknown })
      | null;
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('re-emits zitadel-signout as signout(detail)', () => {
    const onSignout = vi.fn();
    const host = mount(ZitadelLogout, { project, onSignout });
    const el = host.querySelector('zitadel-logout');
    const detail = { name: 'Ada', email: 'ada@example.com' };
    el?.dispatchEvent(new CustomEvent('zitadel-signout', { detail }));
    expect(onSignout).toHaveBeenCalledWith(detail);
  });
});

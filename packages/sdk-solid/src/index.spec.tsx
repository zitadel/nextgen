// @vitest-environment jsdom
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

  it('forwards zitadel-flow-step as onFlowStep(detail)', () => {
    const onFlowStep = vi.fn();
    const host = mount(() => (
      <ZitadelLogin project={project} onFlowStep={onFlowStep} />
    ));
    const el = host.querySelector('zitadel-login');
    const detail = { step: { kind: 'register' } };
    el?.dispatchEvent(new CustomEvent('zitadel-flow-step', { detail }));
    expect(onFlowStep).toHaveBeenCalledWith(detail);
  });
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

  it('forwards zitadel-signout as onSignout(detail)', () => {
    const onSignout = vi.fn();
    const host = mount(() => (
      <ZitadelLogout project={project} onSignout={onSignout} />
    ));
    const el = host.querySelector('zitadel-logout');
    const detail = { name: 'Ada', email: 'ada@example.com' };
    el?.dispatchEvent(new CustomEvent('zitadel-signout', { detail }));
    expect(onSignout).toHaveBeenCalledWith(detail);
  });
});

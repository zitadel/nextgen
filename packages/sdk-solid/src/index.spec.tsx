// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ZitadelLogin, ZitadelLogout } from './index';

const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

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
  it('renders a <zitadel-login> element and forwards the project prop', () => {
    const host = mount(() => (
      <ZitadelLogin project={project} purpose="login" />
    ));
    const el = host.querySelector('zitadel-login') as
      | (HTMLElement & { project?: unknown })
      | null;
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });
});

describe('ZitadelLogout', () => {
  it('renders a <zitadel-logout> element and forwards the project prop', () => {
    const host = mount(() => <ZitadelLogout project={project} />);
    const el = host.querySelector('zitadel-logout') as
      | (HTMLElement & { project?: unknown })
      | null;
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });
});

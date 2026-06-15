// @vitest-environment jsdom
import { render } from '@builder.io/qwik';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@zitadel/components';

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

describe('ZitadelLogin', () => {
  it('renders a <zitadel-login> element and forwards the project prop', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await render(host, <ZitadelLogin project={project} purpose="login" />);
    const el = host.querySelector('zitadel-login') as
      | (HTMLElement & { project?: unknown })
      | null;
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });
});

describe('ZitadelLogout', () => {
  it('renders a <zitadel-logout> element and forwards the project prop', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await render(host, <ZitadelLogout project={project} />);
    const el = host.querySelector('zitadel-logout') as
      | (HTMLElement & { project?: unknown })
      | null;
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });
});

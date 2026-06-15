// @vitest-environment jsdom
import { render } from '@builder.io/qwik';
import { afterEach, describe, expect, it } from 'vitest';

import { ZitadelLogin, ZitadelLogout } from './index';

// A representative project handle (structurally a ZitadelProject).
const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

afterEach(() => {
  document.body.innerHTML = '';
});

describe('ZitadelLogin', () => {
  it('renders a <zitadel-login> element with the project-id/proxy-path attributes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await render(host, <ZitadelLogin project={project} purpose="login" />);
    const el = host.querySelector('zitadel-login');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('project-id')).toBe('proj-test');
    expect(el?.getAttribute('proxy-path')).toBe('/__nextgen');
  });
});

describe('ZitadelLogout', () => {
  it('renders a <zitadel-logout> element with the project-id attribute', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    await render(host, <ZitadelLogout project={project} />);
    const el = host.querySelector('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('project-id')).toBe('proj-test');
  });
});

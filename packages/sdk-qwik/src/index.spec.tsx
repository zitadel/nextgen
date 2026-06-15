import { createDOM } from '@builder.io/qwik/testing';
import { describe, expect, it } from 'vitest';

import { ZitadelLogin, ZitadelLogout } from './index';

// A representative project handle (structurally a ZitadelProject).
const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

describe('ZitadelLogin', () => {
  it('renders a <zitadel-login> element with the project-id/proxy-path attributes', async () => {
    const { screen, render } = await createDOM();
    await render(<ZitadelLogin project={project} purpose="login" />);
    const el = screen.querySelector('zitadel-login');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('project-id')).toBe('proj-test');
    expect(el?.getAttribute('proxy-path')).toBe('/__nextgen');
  });
});

describe('ZitadelLogout', () => {
  it('renders a <zitadel-logout> element with the project-id attribute', async () => {
    const { screen, render } = await createDOM();
    await render(<ZitadelLogout project={project} />);
    const el = screen.querySelector('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('project-id')).toBe('proj-test');
  });
});

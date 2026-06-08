import { describe, expect, it } from 'vitest';

import { ZitadelLoginComponent } from './zitadel-login.component';
import { ZitadelLogoutComponent } from './zitadel-logout.component';

const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

describe('ZitadelLoginComponent', () => {
  it("defaults purpose to 'login'", () => {
    expect(new ZitadelLoginComponent().purpose).toBe('login');
  });

  it('accepts a project input', () => {
    const component = new ZitadelLoginComponent();
    component.project = project;
    expect(component.project).toBe(project);
  });
});

describe('ZitadelLogoutComponent', () => {
  it('accepts a project input', () => {
    const component = new ZitadelLogoutComponent();
    component.project = project;
    expect(component.project).toBe(project);
  });
});

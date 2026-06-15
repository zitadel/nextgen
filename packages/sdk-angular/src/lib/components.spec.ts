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

  it('emits flowStep with the event detail', () => {
    const component = new ZitadelLoginComponent();
    const received: unknown[] = [];
    component.flowStep.subscribe((detail) => received.push(detail));
    const detail = { step: { kind: 'register' } };
    component.onFlowStep(new CustomEvent('zitadel-flow-step', { detail }));
    expect(received).toEqual([detail]);
  });
});

describe('ZitadelLogoutComponent', () => {
  it('accepts a project input', () => {
    const component = new ZitadelLogoutComponent();
    component.project = project;
    expect(component.project).toBe(project);
  });

  it('emits signout with the event detail', () => {
    const component = new ZitadelLogoutComponent();
    const received: unknown[] = [];
    component.signout.subscribe((detail) => received.push(detail));
    const detail = { name: 'Ada', email: 'ada@example.com' };
    component.onSignout(new CustomEvent('zitadel-signout', { detail }));
    expect(received).toEqual([detail]);
  });
});

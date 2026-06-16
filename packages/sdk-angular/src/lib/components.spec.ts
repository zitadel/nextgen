import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ZitadelLoginComponent } from './zitadel-login.component';
import { ZitadelLogoutComponent } from './zitadel-logout.component';

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

describe('ZitadelLogin', () => {
  it('binds the project handle as a property', () => {
    const fixture = TestBed.createComponent(ZitadelLoginComponent);
    fixture.componentRef.setInput('project', project);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const el = host.querySelector<ConfiguredElement>('zitadel-login');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const fixture = TestBed.createComponent(ZitadelLoginComponent);
    fixture.componentRef.setInput('projectId', 'proj-test');
    fixture.componentRef.setInput('proxyPath', '/__nextgen');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const el = host.querySelector<ConfiguredElement>('zitadel-login');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it('forwards zitadel-flow-step as flowStep(detail)', () => {
    const fixture = TestBed.createComponent(ZitadelLoginComponent);
    fixture.componentRef.setInput('project', project);
    const flowStep = vi.fn();
    fixture.componentInstance.flowStep.subscribe(flowStep);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const el = host.querySelector('zitadel-login');
    const detail = { step: { kind: 'register' } };
    el?.dispatchEvent(new CustomEvent('zitadel-flow-step', { detail }));
    expect(flowStep).toHaveBeenCalledWith(detail);
  });
});

describe('ZitadelLogout', () => {
  it('binds the project handle as a property', () => {
    const fixture = TestBed.createComponent(ZitadelLogoutComponent);
    fixture.componentRef.setInput('project', project);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const el = host.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const fixture = TestBed.createComponent(ZitadelLogoutComponent);
    fixture.componentRef.setInput('projectId', 'proj-test');
    fixture.componentRef.setInput('proxyPath', '/__nextgen');
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const el = host.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it('forwards zitadel-signout as signout(detail)', () => {
    const fixture = TestBed.createComponent(ZitadelLogoutComponent);
    fixture.componentRef.setInput('project', project);
    const signout = vi.fn();
    fixture.componentInstance.signout.subscribe(signout);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const el = host.querySelector('zitadel-logout');
    const detail = { name: 'Ada', email: 'ada@example.com' };
    el?.dispatchEvent(new CustomEvent('zitadel-signout', { detail }));
    expect(signout).toHaveBeenCalledWith(detail);
  });
});

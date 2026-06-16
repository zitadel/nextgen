import { TestBed } from '@angular/core/testing';
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
} from '@zitadel/sdk-core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ZitadelLoginComponent } from './zitadel-login.component';
import { ZitadelLogoutComponent } from './zitadel-logout.component';

const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

// `'zitadel-flow-step'` → `'flowStep'`: the camelCased `@Output()` name Angular
// exposes for the event (the `zitadel-` prefix dropped, the rest camelCased).
const outputName = (event: string): string =>
  event
    .replace(/^zitadel-/, '')
    .replace(/-([a-z])/g, (_, c) => c.toUpperCase());

type ConfiguredElement = HTMLElement & {
  project?: unknown;
  projectId?: string;
  proxyPath?: string;
};

// The dynamically-named `@Output()` is an EventEmitter we only `subscribe` to.
type SubscribableOutput = { subscribe(next: (detail: unknown) => void): void };

// Reads the `@Output()` an event maps to off a component instance, typed as a
// subscribable so the spec never reaches into `any`. A missing output (i.e. the
// component never re-emitted a contract event) fails here rather than silently
// passing.
const outputOf = (instance: object, event: string): SubscribableOutput => {
  const name = outputName(event);
  const output = (instance as Record<string, SubscribableOutput | undefined>)[
    name
  ];
  if (!output) throw new Error(`component has no @Output() "${name}"`);
  return output;
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

  it.each(Object.keys(ZITADEL_LOGIN_EVENT_HANDLERS))(
    'forwards %s through its @Output',
    (eventName) => {
      const fixture = TestBed.createComponent(ZitadelLoginComponent);
      fixture.componentRef.setInput('project', project);
      const spy = vi.fn();
      outputOf(fixture.componentInstance, eventName).subscribe(spy);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const el = host.querySelector('zitadel-login');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );
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

  it.each(Object.keys(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    'forwards %s through its @Output',
    (eventName) => {
      const fixture = TestBed.createComponent(ZitadelLogoutComponent);
      fixture.componentRef.setInput('project', project);
      const spy = vi.fn();
      outputOf(fixture.componentInstance, eventName).subscribe(spy);
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const el = host.querySelector('zitadel-logout');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );
});

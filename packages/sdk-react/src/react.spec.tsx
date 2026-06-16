// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ZitadelLogin, ZitadelLogout } from './react';

// A representative project handle. The element still starts its flow before
// @lit/react binds this prop (see vitest.config.ts), so the expected mount-time
// rejection is ignored package-wide; these are light binding/event assertions.
const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

type ConfiguredElement = HTMLElement & {
  project?: unknown;
  projectId?: string;
  proxyPath?: string;
};

afterEach(cleanup);

describe('ZitadelLogin', () => {
  it('binds the project handle as a property', () => {
    const { container } = render(
      <ZitadelLogin project={project} purpose="login" />,
    );
    const el = container.querySelector<ConfiguredElement>('zitadel-login');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const { container } = render(
      <ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />,
    );
    const el = container.querySelector<ConfiguredElement>('zitadel-login');
    expect(el).not.toBeNull();
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it('forwards zitadel-flow-step as onFlowStep(detail)', () => {
    const onFlowStep = vi.fn();
    const { container } = render(
      <ZitadelLogin project={project} onFlowStep={onFlowStep} />,
    );
    const el = container.querySelector('zitadel-login');
    const detail = { step: { kind: 'register' } };
    el?.dispatchEvent(new CustomEvent('zitadel-flow-step', { detail }));
    expect(onFlowStep).toHaveBeenCalledWith(detail);
  });
});

describe('ZitadelLogout', () => {
  it('binds the project handle as a property', () => {
    const { container } = render(<ZitadelLogout project={project} />);
    const el = container.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const { container } = render(
      <ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" />,
    );
    const el = container.querySelector<ConfiguredElement>('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it('forwards zitadel-signout as onSignout(detail)', () => {
    const onSignout = vi.fn();
    const { container } = render(
      <ZitadelLogout project={project} onSignout={onSignout} />,
    );
    const el = container.querySelector('zitadel-logout');
    const detail = { name: 'Ada', email: 'ada@example.com' };
    el?.dispatchEvent(new CustomEvent('zitadel-signout', { detail }));
    expect(onSignout).toHaveBeenCalledWith(detail);
  });
});

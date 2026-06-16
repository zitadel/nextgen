// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
} from '@zitadel/sdk-core/types';
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
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    'forwards %s to its callback',
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(
        <ZitadelLogin project={project} {...{ [handlerProp]: spy }} />,
      );
      const el = container.querySelector('zitadel-login');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );
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
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    'forwards %s to its callback',
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(
        <ZitadelLogout project={project} {...{ [handlerProp]: spy }} />,
      );
      const el = container.querySelector('zitadel-logout');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );
});

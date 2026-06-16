// @vitest-environment jsdom
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
} from '@zitadel/components';

import { cleanup, render } from '@testing-library/vue';
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
} from '@zitadel/sdk-core/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref, type Ref } from 'vue';

import ZitadelLogin from './components/ZitadelLogin';
import ZitadelLogout from './components/ZitadelLogout';

// A consumer's `ref` on these components resolves to the component instance,
// whose `expose({ element })` surfaces the inner DOM node. Vue's exposed proxy
// auto-unwraps the exposed `Ref`, so the consumer reads the element directly as
// `r.value.element`. Mount the component under a parent that holds such a ref
// and forward the captured instance out, mirroring that consumer access.
function mountWithInstanceRef<Element extends HTMLElement>(
  child: typeof ZitadelLogin | typeof ZitadelLogout,
): {
  captured: Ref<{ element: Element | null } | null>;
  container: HTMLElement;
} {
  const captured = ref<{ element: Element | null } | null>(null);
  const parent = defineComponent({
    setup: () => () => h(child, { ref: captured }),
  });
  const { container } = render(parent);
  return { captured, container };
}

const project = { projectId: 'proj-test', proxyPath: '/__nextgen' };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('no network'))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ZitadelLogin', () => {
  it('binds the project handle as a property', () => {
    const { container } = render(ZitadelLogin, {
      props: { project, purpose: 'login' },
    });
    const el = container.querySelector<ZitadelLoginElement>('zitadel-login');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const { container } = render(ZitadelLogin, {
      props: { projectId: 'proj-test', proxyPath: '/__nextgen' },
    });
    const el = container.querySelector<ZitadelLoginElement>('zitadel-login');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    'forwards %s to its callback',
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(ZitadelLogin, {
        props: { project, [handlerProp]: spy },
      });
      const el = container.querySelector('zitadel-login');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it('exposes the rendered element via the instance ref', () => {
    const { captured, container } =
      mountWithInstanceRef<ZitadelLoginElement>(ZitadelLogin);
    const element = captured.value!.element;
    expect(element).not.toBeNull();
    expect(element!.tagName.toLowerCase()).toBe('zitadel-login');
    expect(element).toBe(container.querySelector('zitadel-login'));
  });
});

describe('ZitadelLogout', () => {
  it('binds the project handle as a property', () => {
    const { container } = render(ZitadelLogout, { props: { project } });
    const el = container.querySelector<ZitadelLogoutElement>('zitadel-logout');
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it('binds discrete projectId/proxyPath', () => {
    const { container } = render(ZitadelLogout, {
      props: { projectId: 'proj-test', proxyPath: '/__nextgen' },
    });
    const el = container.querySelector<ZitadelLogoutElement>('zitadel-logout');
    expect(el!.projectId).toBe('proj-test');
    expect(el!.proxyPath).toBe('/__nextgen');
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    'forwards %s to its callback',
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(ZitadelLogout, {
        props: { project, [handlerProp]: spy },
      });
      const el = container.querySelector('zitadel-logout');
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it('exposes the rendered element via the instance ref', () => {
    const { captured, container } =
      mountWithInstanceRef<ZitadelLogoutElement>(ZitadelLogout);
    const element = captured.value!.element;
    expect(element).not.toBeNull();
    expect(element!.tagName.toLowerCase()).toBe('zitadel-logout');
    expect(element).toBe(container.querySelector('zitadel-logout'));
  });
});

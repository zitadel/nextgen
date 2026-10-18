// @vitest-environment jsdom
import type {
  ZitadelLogin as ZitadelLoginElement,
  ZitadelLogout as ZitadelLogoutElement,
  ZitadelSession as ZitadelSessionElement,
} from "@zitadel/components";

import { act, render, waitFor } from "@testing-library/react";
import { businessLocales as componentsBusinessLocales } from "@zitadel/components";
import {
  ZITADEL_LOGIN_EVENT_HANDLERS,
  ZITADEL_LOGOUT_EVENT_HANDLERS,
  ZITADEL_SESSION_EVENT_HANDLERS,
} from "@zitadel/sdk-core/types";
import * as React from "react";
import { Suspense, startTransition } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { businessLocales, ZitadelLogin, ZitadelLogout, ZitadelSession } from "./index";

// A representative project handle. The element still starts its flow before
// @lit/react binds this prop (see vitest.config.ts), so the expected mount-time
// rejection is ignored package-wide; these are light binding/event assertions.
const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

afterEach(() => {
  vi.unstubAllGlobals();
});

// The widget itself fails its first request (no synthetic event): the only way
// it raises `zitadel-session-error` on its own, always after an awaited fetch.
const failEveryRequest = () =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 })),
  );

describe("ZitadelLogin", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(<ZitadelLogin project={project} purpose="login" />);
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(<ZitadelLogin projectId="proj-test" proxyPath="/__nextgen" />);
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards locales and lang to the widget", () => {
    const locales = { en: { "identifier.title": "Welcome back" } };
    const { container } = render(<ZitadelLogin project={project} locales={locales} lang="de" />);
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.locales).toBe(locales);
    expect(el!.lang).toBe("de");
  });

  it("forwards the preview props to the widget", () => {
    const { container } = render(
      <ZitadelLogin project={project} previewState="success" previewSuccessStep="done" />,
    );
    const el = container.querySelector<ZitadelLoginElement>("zitadel-login");
    expect(el!.previewState).toBe("success");
    expect(el!.previewSuccessStep).toBe("done");
  });

  it.each(Object.entries(ZITADEL_LOGIN_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(<ZitadelLogin project={project} {...{ [handlerProp]: spy }} />);
      const el = container.querySelector("zitadel-login");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it("forwards a ref to the underlying element", () => {
    const ref = React.createRef<ZitadelLoginElement>();
    const { container } = render(<ZitadelLogin ref={ref} project={project} />);
    expect(ref.current).toBe(container.querySelector("zitadel-login"));
    expect(ref.current?.tagName.toLowerCase()).toBe("zitadel-login");
  });
});

describe("ZitadelLogout", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(<ZitadelLogout project={project} />);
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(<ZitadelLogout projectId="proj-test" proxyPath="/__nextgen" />);
    const el = container.querySelector<ZitadelLogoutElement>("zitadel-logout");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it.each(Object.entries(ZITADEL_LOGOUT_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(<ZitadelLogout project={project} {...{ [handlerProp]: spy }} />);
      const el = container.querySelector("zitadel-logout");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it.each([
    ["zitadel-session-error", "onSessionError"],
    ["zitadel-signout", "onSignout"],
  ])("forwards %s raised the moment the element mounts", (eventName, handlerProp) => {
    const spy = vi.fn();
    const detail = { probe: eventName };
    const early = (el: ZitadelLogoutElement | null) => {
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
    };
    render(<ZitadelLogout project={project} ref={early} {...{ [handlerProp]: spy }} />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(detail);
  });

  it("delivers the error the widget raises when its own first request fails", async () => {
    failEveryRequest();
    const spy = vi.fn();
    render(<ZitadelLogout project={project} onSessionError={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ phase: "load", status: 500 }));
  });

  it("forwards a ref to the underlying element", () => {
    const ref = React.createRef<ZitadelLogoutElement>();
    const { container } = render(<ZitadelLogout ref={ref} project={project} />);
    expect(ref.current).toBe(container.querySelector("zitadel-logout"));
    expect(ref.current?.tagName.toLowerCase()).toBe("zitadel-logout");
  });
});

describe("ZitadelSession", () => {
  it("binds the project handle as a property", () => {
    const { container } = render(<ZitadelSession project={project} />);
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el).not.toBeNull();
    expect(el!.project).toBe(project);
  });

  it("binds discrete projectId/proxyPath", () => {
    const { container } = render(<ZitadelSession projectId="proj-test" proxyPath="/__nextgen" />);
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.projectId).toBe("proj-test");
    expect(el!.proxyPath).toBe("/__nextgen");
  });

  it("forwards the surface variant/theme", () => {
    const { container } = render(
      <ZitadelSession project={project} variant="page" theme="light" suppressHeader />,
    );
    const el = container.querySelector<ZitadelSessionElement>("zitadel-session");
    expect(el!.variant).toBe("page");
    expect(el!.theme).toBe("light");
    expect(el!.suppressHeader).toBe(true);
  });

  it.each(Object.entries(ZITADEL_SESSION_EVENT_HANDLERS))(
    "forwards %s to its callback",
    (eventName, handlerProp) => {
      const spy = vi.fn();
      const { container } = render(
        <ZitadelSession project={project} {...{ [handlerProp]: spy }} />,
      );
      const el = container.querySelector("zitadel-session");
      const detail = { probe: eventName };
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
      expect(spy).toHaveBeenCalledWith(detail);
    },
  );

  it.each([
    ["zitadel-session-error", "onSessionError"],
    ["zitadel-signout", "onSignout"],
  ])("forwards %s raised the moment the element mounts", (eventName, handlerProp) => {
    const spy = vi.fn();
    const detail = { probe: eventName };
    const early = (el: ZitadelSessionElement | null) => {
      el?.dispatchEvent(new CustomEvent(eventName, { detail }));
    };
    render(<ZitadelSession project={project} ref={early} {...{ [handlerProp]: spy }} />);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(detail);
  });

  it("delivers the error the widget raises when its own first request fails", async () => {
    failEveryRequest();
    const spy = vi.fn();
    render(<ZitadelSession project={project} onSessionError={spy} />);
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ phase: "load", status: 500 }));
  });

  it("forwards a ref to the underlying element", () => {
    const ref = React.createRef<ZitadelSessionElement>();
    const { container } = render(<ZitadelSession ref={ref} project={project} />);
    expect(ref.current).toBe(container.querySelector("zitadel-session"));
    expect(ref.current?.tagName.toLowerCase()).toBe("zitadel-session");
  });
});

describe("session handlers under concurrent rendering", () => {
  // Suspends until released, standing in for a sibling that is not ready yet.
  const gate = { release: () => {}, promise: Promise.resolve() };
  const Sibling = ({ blocked }: { blocked: boolean }) => {
    if (blocked) throw gate.promise;
    return null;
  };

  function Harness({ onSessionError, blocked }: { onSessionError: () => void; blocked: boolean }) {
    return (
      <Suspense fallback={null}>
        <ZitadelSession project={project} onSessionError={onSessionError} />
        <Sibling blocked={blocked} />
      </Suspense>
    );
  }

  const raise = (container: HTMLElement) =>
    container
      .querySelector("zitadel-session")
      ?.dispatchEvent(new CustomEvent("zitadel-session-error", { detail: {} }));

  it("does not hand an abandoned update's callback to the widget still on screen", async () => {
    gate.promise = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    const committed = vi.fn();
    const abandoned = vi.fn();
    const { container, rerender } = render(<Harness onSessionError={committed} blocked={false} />);

    await act(async () => {
      startTransition(() => {
        rerender(<Harness onSessionError={abandoned} blocked />);
      });
    });
    raise(container);

    expect(abandoned).not.toHaveBeenCalled();
    expect(committed).toHaveBeenCalledTimes(1);
  });

  it("uses the new callback once the update commits", async () => {
    const before = vi.fn();
    const after = vi.fn();
    const { container, rerender } = render(<Harness onSessionError={before} blocked={false} />);
    rerender(<Harness onSessionError={after} blocked={false} />);
    raise(container);

    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe("businessLocales", () => {
  it("re-exports the business copy overlay from @zitadel/components", () => {
    expect(businessLocales).toBe(componentsBusinessLocales);
  });
});

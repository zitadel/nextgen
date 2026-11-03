"use client";

import type { ZitadelLogin } from "@zitadel/components";
import { useEffect, useState } from "react";

import { MOCK_API, startMock } from "./mock";

// The examples load the components in the browser only: defining a custom
// element needs `customElements`, which a server render does not have.
let atoms: Promise<unknown> | undefined;
let login: Promise<unknown> | undefined;

/** Defines the atoms (`<zl-*>`). */
export const loadAtoms = () => {
  atoms ??= import("@zitadel/components/atoms");
  return atoms;
};

/** Defines `<zitadel-login>` and its atoms, and starts the mock it calls. */
export const loadLogin = () => {
  login ??= Promise.all([import("@zitadel/components"), startMock()]);
  return login;
};

/** Whether `load`, one of the loaders above, has settled yet. */
export function useLoaded(load: () => Promise<unknown>): "loading" | "ready" | "failed" {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  useEffect(() => {
    let canceled = false;
    load().then(
      () => !canceled && setState("ready"),
      () => !canceled && setState("failed"),
    );
    return () => {
      canceled = true;
    };
  }, [load]);
  return state;
}

/** What an example shows until its components have loaded, or if they cannot. */
export function ExampleStatus({ failed }: { failed: boolean }) {
  return (
    <p className="my-0 text-sm text-fd-muted-foreground">
      {failed ? "The example could not load." : "Loading the example…"}
    </p>
  );
}

/**
 * The docs' theme, which the switch writes to `<html data-theme>`
 * (app/layout.tsx); undefined until the page has mounted. The atoms read the
 * tokens it selects on their own; `<zitadel-login>` paints from its `theme`.
 */
export function useDocsTheme(): "light" | "dark" | undefined {
  const [theme, setTheme] = useState<"light" | "dark">();
  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset.theme === "light" ? "light" : "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/** The purposes the mock walks a flow for. */
export type MockedPurpose = Extract<ZitadelLogin["purpose"], "login" | "register">;

export interface MockedLoginProps {
  purpose?: MockedPurpose;
  previewState?: ZitadelLogin["previewState"];
  lang?: string;
  locales?: ZitadelLogin["locales"];
}

/**
 * `<zitadel-login>` over the mock (mock.ts), in the docs' theme. Another
 * purpose starts another flow; another preview state shows the step already
 * loaded in it. One per page: every login on a page walks the same mock flow.
 */
export function MockedLogin({ purpose = "login", previewState, lang, locales }: MockedLoginProps) {
  const state = useLoaded(loadLogin);
  const theme = useDocsTheme();
  if (state !== "ready" || !theme) return <ExampleStatus failed={state === "failed"} />;
  return (
    <zitadel-login
      key={purpose}
      // Any project id starts the mock's flow.
      project-id="docs"
      proxy-path={MOCK_API}
      purpose={purpose}
      preview-state={previewState || undefined}
      theme={theme}
      lang={lang}
      locales={locales}
    />
  );
}

/**
 * Test-only harnesses for the reactivity specs. They live in their own module
 * because qwikVite extracts every `component$` into a lazily-loaded QRL chunk,
 * and loading that chunk re-imports its source module — which, inside a `.spec`
 * file, would re-run `describe()` and crash the Vitest runner. Each harness reads
 * an exported signal, so a spec can change a prop after mount (by mutating the
 * signal) and assert that the wrapped widget re-applies it. Not part of the
 * library build (the entry is `index.tsx`) and excluded from the emitted types.
 */
import { component$, createSignal } from "@qwik.dev/core";

import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "../index";

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

export const loginTheme = createSignal<"light" | "dark">("light");
export const LoginHarness = component$(() => (
  <ZitadelLogin project={project} theme={loginTheme.value} />
));

export const logoutTheme = createSignal<"light" | "dark">("light");
export const LogoutHarness = component$(() => (
  <ZitadelLogout project={project} theme={logoutTheme.value} />
));

export const sessionHeading = createSignal("Signed in");
export const SessionHarness = component$(() => (
  <ZitadelSession project={project} heading={sessionHeading.value} />
));

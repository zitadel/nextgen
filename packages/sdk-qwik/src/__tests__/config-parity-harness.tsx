import { component$ } from "@qwik.dev/core";
import type {
  ZitadelLoginConfig,
  ZitadelLogoutConfig,
  ZitadelSessionConfig,
} from "@zitadel/sdk-core/types";

import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "../index";

const project = { projectId: "proj-test", proxyPath: "/__nextgen" };

// Every config key set to a distinct value. `Required<…>` makes `tsc` fail here
// when a key is added to a config type, so a new key cannot skip this check.
// These and the components spreading them live outside the spec because Qwik
// loads a component's QRL by importing its module, and re-importing a spec file
// would re-run its `describe` calls.
export const loginConfig: Required<ZitadelLoginConfig> = {
  project,
  projectId: "proj-parity",
  proxyPath: "/__parity",
  variant: "page",
  theme: "dark",
  suppressHeader: true,
  suppressPasswordToggle: true,
  purpose: "register",
  flowName: "parity-flow",
  postSignInUrl: "/parity-after-login",
  resumeFlowId: "flow_parity",
  locales: { en: { "identifier.title": "Parity" } },
  lang: "de",
};

export const sessionConfig: Required<ZitadelSessionConfig> = {
  project,
  projectId: "proj-parity",
  proxyPath: "/__parity",
  postSignOutUrl: "/parity-after-sign-out",
  heading: "Parity heading",
  logoutLabel: "Parity sign out",
  variant: "page",
  theme: "dark",
  suppressHeader: true,
};

export const logoutConfig: Required<ZitadelLogoutConfig> = {
  project,
  projectId: "proj-parity",
  proxyPath: "/__parity",
  postSignOutUrl: "/parity-after-sign-out",
  theme: "dark",
};

export const LoginConfigHarness = component$(() => <ZitadelLogin {...loginConfig} />);

export const SessionConfigHarness = component$(() => <ZitadelSession {...sessionConfig} />);

export const LogoutConfigHarness = component$(() => <ZitadelLogout {...logoutConfig} />);

import type { InputSignalWithTransform, Type } from "@angular/core";
import type {
  ZitadelLoginConfig,
  ZitadelLogoutConfig,
  ZitadelSessionConfig,
} from "@zitadel/sdk-core/types";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { ZitadelLoginProps, ZitadelLogoutProps, ZitadelSessionProps } from "./types";

import { ZitadelLogin } from "./zitadel-login.component";
import { ZitadelLogout } from "./zitadel-logout.component";
import { ZitadelSession } from "./zitadel-session.component";

/**
 * The write type of every signal input of a component instance, keyed by input name.
 */
type InputsOf<Instance> = {
  readonly [K in keyof Instance as Instance[K] extends InputSignalWithTransform<
    infer _Read,
    infer _Written
  >
    ? K
    : never]?: Instance[K] extends InputSignalWithTransform<infer _Read, infer Written>
    ? Written
    : never;
};

/**
 * Every key of a props type, as an object that fails to compile when a key is missing or extra.
 */
type KeysOf<Props> = { readonly [K in keyof Required<Props>]: true };

/**
 * Reads the input names Angular registered for a component class.
 *
 * Angular has no public API that lists the inputs of a component, so this reads the private
 * `ɵcmp.inputs` field. The specs below assert the list is not empty, so a future Angular that
 * moves the field fails loudly instead of comparing two empty sets.
 *
 * @param component - The component class to read.
 * @returns The sorted input names.
 */
function inputNames(component: Type<unknown>): string[] {
  const definition = (component as unknown as { ɵcmp: { inputs: Record<string, unknown> } }).ɵcmp;
  return Object.keys(definition.inputs).sort();
}

const loginKeys: KeysOf<ZitadelLoginProps> = {
  project: true,
  projectId: true,
  proxyPath: true,
  variant: true,
  theme: true,
  suppressHeader: true,
  suppressPasswordToggle: true,
  purpose: true,
  flowName: true,
  postSignInUrl: true,
  forcePostSignInUrl: true,
  resumeFlowId: true,
  locales: true,
  lang: true,
};

const logoutKeys: KeysOf<ZitadelLogoutProps> = {
  project: true,
  projectId: true,
  proxyPath: true,
  postSignOutUrl: true,
  theme: true,
};

const sessionKeys: KeysOf<ZitadelSessionProps> = {
  project: true,
  projectId: true,
  proxyPath: true,
  postSignOutUrl: true,
  heading: true,
  logoutLabel: true,
  variant: true,
  theme: true,
  suppressHeader: true,
};

describe("the Props types equal the component inputs", () => {
  it.each([
    ["ZitadelLogin", ZitadelLogin, loginKeys],
    ["ZitadelLogout", ZitadelLogout, logoutKeys],
    ["ZitadelSession", ZitadelSession, sessionKeys],
  ])("%s declares exactly the keys of its Props type", (_name, component, keys) => {
    const names = inputNames(component);

    expect(names.length).toBeGreaterThan(0);
    expect(names).toEqual(Object.keys(keys).sort());
  });

  it("types the inputs of each component as its shared config", () => {
    expectTypeOf<ZitadelLoginProps>().toEqualTypeOf<ZitadelLoginConfig>();
    expectTypeOf<ZitadelLogoutProps>().toEqualTypeOf<ZitadelLogoutConfig>();
    expectTypeOf<ZitadelSessionProps>().toEqualTypeOf<ZitadelSessionConfig>();
    expectTypeOf<InputsOf<ZitadelLogin>>().toEqualTypeOf<ZitadelLoginProps>();
    expectTypeOf<InputsOf<ZitadelLogout>>().toEqualTypeOf<ZitadelLogoutProps>();
    expectTypeOf<InputsOf<ZitadelSession>>().toEqualTypeOf<ZitadelSessionProps>();
  });
});

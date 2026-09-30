import type { ComponentType } from "react";

import { PasskeyScreen } from "./screens/passkey";
import { SignInScreen } from "./screens/sign-in";
import { SignUpScreen } from "./screens/sign-up";
import { RegisterSsoScreen, SsoConflictScreen, SsoFlowErrorScreen } from "./screens/sso";

/**
 * Two groups, kept apart in the lab's navigation:
 *
 * - `baseline` — only states that exist on the approved Figma `✅ Login` page
 *   (file "Zitadel – Design System – External"). Change these only when Figma
 *   changes.
 * - `sso` — exploration states for Google social login (#851, UI in #1042).
 *   Not designed yet: they reuse the baseline shell and components, and all
 *   copy is placeholder for the locale keys listed in `keys`.
 *
 * Deliberately absent: a Google redirect screen (`sso-redirect` navigates the
 * window away without rendering) and a returning-user success screen (the flow
 * completes without another ZITADEL step).
 */
export type AuthStateGroup = "baseline" | "sso";

interface AuthStateBase {
  /** URL hash — `/auth-lab#<id>` opens the state directly. */
  id: string;
  label: string;
  note?: string;
  Screen: ComponentType;
}

export interface BaselineState extends AuthStateBase {
  group: "baseline";
  /** The Figma block / frame name. */
  figma: string;
  /** Figma node ids; `mobile` is absent where the page has no 360 frame. */
  nodes: { desktop: string; mobile?: string };
}

export interface SsoState extends AuthStateBase {
  group: "sso";
  /** Where the state is defined: issue plus flow step or error surface. */
  source: string;
  /** Locale keys the placeholder copy stands in for (proposed where #1042 has no exact name). */
  keys: string[];
}

export type AuthState = BaselineState | SsoState;

export const AUTH_STATE_GROUPS: { id: AuthStateGroup; label: string }[] = [
  { id: "baseline", label: "Figma baseline" },
  { id: "sso", label: "SSO exploration" },
];

/** The state `/auth-lab` opens on without (or with an unknown) hash. */
export const DEFAULT_AUTH_STATE: AuthState = {
  group: "baseline",
  id: "sign-in",
  label: "Sign in",
  figma: "Blocks / signin",
  nodes: { desktop: "1705:1533" },
  Screen: () => <SignInScreen />,
};

export const AUTH_STATES: AuthState[] = [
  // --- Figma baseline -------------------------------------------------------
  DEFAULT_AUTH_STATE,
  {
    group: "baseline",
    id: "sign-in-alert",
    label: "Sign in · alert",
    figma: "Blocks / signinAlert",
    nodes: { desktop: "1705:1535", mobile: "1705:2247" },
    Screen: () => (
      <SignInScreen
        alert={{
          title: "We couldn’t sign you in.",
          description: "Please try again in a few minutes.",
        }}
      />
    ),
  },
  {
    group: "baseline",
    id: "passkey",
    label: "Passkey",
    figma: "Blocks / signinPasskey",
    nodes: { desktop: "1705:2332", mobile: "1705:2355" },
    note: "Passkey enrolment prompt shown after sign-in. No trustmark in Figma.",
    Screen: PasskeyScreen,
  },
  {
    group: "baseline",
    id: "sign-up-card",
    label: "Sign up · card",
    figma: "Blocks / signup",
    nodes: { desktop: "1705:2161", mobile: "1705:2204" },
    note: "Sign-up variant A (library block). Canonical variant still to decide.",
    Screen: () => <SignUpScreen variant="card" />,
  },
  {
    group: "baseline",
    id: "sign-up-logo",
    label: "Sign up · logo",
    figma: "Blocks / signup (detached, with Logo)",
    nodes: { desktop: "2226:10119" },
    note: "Sign-up variant B: brand-logo lockup above the card; footer prompt uses the muted-foreground token. Canonical variant still to decide.",
    Screen: () => <SignUpScreen variant="logo" />,
  },

  // --- SSO exploration ------------------------------------------------------
  {
    group: "sso",
    id: "sign-in-google",
    label: "Sign in + Google",
    source: "#1042 · entry step with sso_providers",
    keys: [],
    note: "Sign in baseline + provider block (divider, one button per provider). Divider copy and brand styling are open in #1042.",
    Screen: () => <SignInScreen sso />,
  },
  {
    group: "sso",
    id: "sign-up-google",
    label: "Sign up + Google",
    source: "#1042 · entry step with sso_providers",
    keys: [],
    note: "Sign up baseline (variant A) + the same provider block.",
    Screen: () => <SignUpScreen variant="card" sso />,
  },
  {
    group: "sso",
    id: "register-sso",
    label: "Register (SSO)",
    source: "#1042 · step register-sso",
    keys: ["register-sso.title", "register-sso.description", "register-sso.action.submit"],
    note: "New Google user; required user-schema attributes missing. Fields are schema-driven — the scaffold collects email.",
    Screen: RegisterSsoScreen,
  },
  {
    group: "sso",
    id: "sso-conflict",
    label: "Account conflict",
    source: "#1042 · step sso-conflict",
    keys: [
      "sso-conflict.title",
      "sso-conflict.description",
      "sso-conflict.action.submit",
      "sso-conflict.action.passkey",
      "sso-conflict.action.sign_in",
    ],
    note: "An existing ZITADEL account collides with the Google identity; no linking — the user signs in to the existing account.",
    Screen: SsoConflictScreen,
  },
  {
    group: "sso",
    id: "sso-cancelled",
    label: "Cancelled",
    source: "#1042 · originating-step error (access_denied)",
    keys: ["error.sso_access_denied (proposed)"],
    Screen: () => (
      <SignInScreen
        sso
        alert={{
          title: "Sign-in with Google was cancelled.",
          description: "Try again or choose another way to sign in.",
        }}
      />
    ),
  },
  {
    group: "sso",
    id: "sso-provider-error",
    label: "Provider error",
    source: "#1042 · originating-step error (generic provider)",
    keys: ["error.sso_provider (proposed)"],
    note: "Generic by design: no provider or configuration detail reaches the user.",
    Screen: () => (
      <SignInScreen
        sso
        alert={{
          title: "We couldn’t sign you in with Google.",
          description: "Try again or choose another way to sign in.",
        }}
      />
    ),
  },
  {
    group: "sso",
    id: "sso-flow-error",
    label: "Flow error",
    source: "#1042 · flow-level error with restart",
    keys: ["error.flow.title (proposed)", "error.flow.action.restart (proposed)"],
    note: "Unrecoverable (expired state, cookie mismatch, cross-schema). Not a step: generic message + Restart, no details.",
    Screen: SsoFlowErrorScreen,
  },
];

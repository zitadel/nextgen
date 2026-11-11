"use client";

import type { LoginPreviewState } from "@zitadel/components";

import { MockedLogin, type MockedPurpose } from "./shared";

export interface LoginExampleProps {
  /** `login` signs in, `register` signs up. */
  purpose?: MockedPurpose;
  /**
   * Holds the step in one state and submits nothing, as the console's
   * branding screen does. Unset, the flow runs: any email and password sign
   * in.
   */
  previewState?: LoginPreviewState;
}

/** `<zitadel-login>`, sdks/components.mdx's example. */
export function LoginExample({ purpose = "login", previewState }: LoginExampleProps) {
  return <MockedLogin purpose={purpose} previewState={previewState} />;
}

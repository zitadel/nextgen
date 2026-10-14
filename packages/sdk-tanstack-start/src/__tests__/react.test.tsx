import {
  ZitadelLogin as ReactLogin,
  ZitadelLogout as ReactLogout,
  ZitadelSession as ReactSession,
} from "@zitadel/sdk-react";
import { describe, expect, it } from "vitest";

import { ZitadelLogin, ZitadelLogout, ZitadelSession } from "../react";

// The TanStack Start wrappers are @zitadel/sdk-react's, so they carry every
// event (onFlowRedirect included), children slots, and the session card.
describe("@zitadel/sdk-tanstack-start/react", () => {
  it.each([
    ["ZitadelLogin", ZitadelLogin, ReactLogin],
    ["ZitadelLogout", ZitadelLogout, ReactLogout],
    ["ZitadelSession", ZitadelSession, ReactSession],
  ])("exports @zitadel/sdk-react's %s", (_name, exported, original) => {
    expect(exported).toBe(original);
  });
});

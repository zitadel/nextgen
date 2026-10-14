import * as sdkReact from "@zitadel/sdk-react";
import { describe, expect, it } from "vitest";

import * as react from "../react";

// The TanStack Start wrappers are @zitadel/sdk-react's, so they carry every
// event (onFlowRedirect included), children slots, and the session card.
describe("@zitadel/sdk-tanstack-start/react", () => {
  it.each(["ZitadelLogin", "ZitadelLogout", "ZitadelSession"] as const)(
    "exports @zitadel/sdk-react's %s",
    (name) => {
      expect(react[name]).toBe(sdkReact[name]);
    },
  );
});

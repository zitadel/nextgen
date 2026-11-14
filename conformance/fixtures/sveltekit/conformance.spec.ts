import { conformanceSuite } from "@zitadel/conformance";

// src/hooks.server.ts guards /profile.
conformanceSuite({ protectedRoute: "/profile" });

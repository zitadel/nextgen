import { conformanceSuite } from "@zitadel/conformance";

// src/start.ts guards /profile.
conformanceSuite({ protectedRoute: "/profile" });

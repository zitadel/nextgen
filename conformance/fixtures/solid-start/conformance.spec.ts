import { conformanceSuite } from "@zitadel/conformance";

// src/middleware.ts guards /profile.
conformanceSuite({ protectedRoute: "/profile" });

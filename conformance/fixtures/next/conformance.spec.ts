import { conformanceSuite } from "@zitadel/conformance";

// proxy.ts guards /profile.
conformanceSuite({ protectedRoute: "/profile" });

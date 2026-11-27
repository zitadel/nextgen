import { conformanceSuite } from "@zitadel/conformance";

// src/routes/plugin@zitadel.ts guards /profile.
conformanceSuite({ protectedRoute: "/profile" });

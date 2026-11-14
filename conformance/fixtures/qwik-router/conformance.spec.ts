import { conformanceSuite } from "@zitadel/conformance";

// src/routes/plugin@nextgen.ts guards /profile.
conformanceSuite({ protectedRoute: "/profile" });

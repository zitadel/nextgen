import { conformanceSuite } from "@zitadel/conformance";

// The @zitadel/sdk-nuxt module (nuxt.config.ts) guards /profile.
conformanceSuite({ protectedRoute: "/profile" });

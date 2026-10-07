import { setupTestBed } from "@analogjs/vitest-angular/setup-testbed";
import { serveMockFlowApi } from "@zitadel/api-mock/vitest";

// Serves the mock Flow API (`@zitadel/api-mock`) to every spec, so a mounted
// widget talks to the same handlers the components suite and Storybook use
// instead of a network that is not there.
serveMockFlowApi();

// Initialises the Angular testing environment (zoneless) so specs can render
// components through TestBed and assert against the real DOM.
setupTestBed();

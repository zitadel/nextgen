import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { TEST_PROJECT_ID } from "./project-scope.fixture";

/**
 * Test fixture: the one MSW server every console spec answers requests from.
 * `test-setup.ts` starts it, resets it after each test and closes it after each
 * file, so a spec only imports it and adds the handlers it asserts on with
 * `server.use(...)`.
 *
 * An unhandled request is an error, never a pass-through. A request a test did
 * not mock used to go to the real network, where the refused connection came
 * back at no particular time: after the test on a fast machine, inside it on a
 * loaded CI runner, where whatever the screen did with the failure failed the
 * test. Refusing it in MSW fails the test that made it, every time.
 *
 * Paths match any origin (`*`): some specs bind the API base to
 * `http://localhost/api`, others import the router before they can and request
 * the relative `/api` default.
 */

/**
 * The one read every `_authed` screen makes for its chrome rather than for the
 * screen under test: the context switcher and the `_authed` guard both list the
 * person's projects, and the default lists the fixture's project so the
 * selection most specs open under is a listed one. A spec about the switcher or
 * the guard overrides it with `server.use(...)`.
 *
 * `GET /projects/{id}` is deliberately not defaulted: the switcher reads it only
 * for a selection the list does not carry, which is a spec opening under another
 * project, and a catch-all there would answer a forgotten mock with made-up data
 * instead of erroring. The two specs that do this (`app-shell`, `branding`) add
 * the handler themselves.
 */
const shellHandlers = [
  http.get("*/api/users/me/projects", () =>
    HttpResponse.json({ projects: [{ id: TEST_PROJECT_ID, name: "Test project" }] }),
  ),
];

export const server = setupServer(...shellHandlers);

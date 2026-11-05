import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Home.
 *
 * **There is no Home screen, so `/` lands on Users.** The designed overview is a
 * set of figures nothing can compute: the stat cards need an aggregate or count
 * endpoint (`POST /users/query` and `POST /projects/query` return pages),
 * "Total Projects" and its trend need a multi-project list and a time series,
 * and the "Browse all" rows have no resource behind them at all. Rendering a
 * page that explains this is worse than going somewhere useful, because `/` is
 * where sign-in, `zitadel console`, the logo and the claim flow's "Open the
 * console" all land.
 *
 * Users is the target because it is the first thing a developer arriving
 * through those paths can check: whoever just signed up through their app is
 * listed there. A fresh project's Teams screen is empty until someone creates
 * a team, which reads as "nothing happened".
 * Point this at the overview when the figures behind it exist.
 *
 * Users acts on the selected project. The `_authed` guard has given `/` the
 * default one by the time this runs, so with none selected there are several
 * projects to choose from (or none), and `/` lands on Projects itself: by way
 * of Users it would arrive as a detour, `Continue to Users` (D22), which is
 * not what anybody arriving at the console asked for.
 */
export const Route = createFileRoute("/_authed/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: search.project ? "/users" : "/projects" });
  },
});

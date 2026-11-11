import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { User } from "lucide-react";
import { useCallback } from "react";

import { requireProjectScope } from "@/features/projects/project-scope";
import { type UsersScreenProps, UsersScreen } from "@/features/users/components/users-screen";
import { PROJECT_USER_LINKS } from "@/features/users/links";
import { validateUsersSearch } from "@/features/users/list";
import { loadUsers } from "@/features/users/load";
import { searchTerm } from "@/lib/search-params";

export const Route = createFileRoute("/_authed/users/")({
  // `User`, not `Users`: the single-person glyph. The plural two-person one
  // reads as a group.
  // Order 3: Teams sits at 2.
  staticData: { scope: "project", nav: { label: "Users", order: 3, icon: User } },
  validateSearch: validateUsersSearch,
  // The search term is left out of the deps, so a new term is not a new match:
  // past the router's pending delay a new match swaps the screen for the pending
  // state, and the field being typed in goes with it. Staying on a match does not
  // reload it, so the screen reads a term that comes after the load itself, once.
  // A first load keeps the delay.
  loaderDeps: ({ search: { q: _q, ...deps } }) => deps,
  // `location.search` is the URL's, which `validateSearch` has not been over.
  loader: ({ deps: { project, ...deps }, location }) =>
    loadUsers(
      requireProjectScope(project),
      { ...deps, q: searchTerm((location.search as { q?: unknown }).q) },
      PROJECT_USER_LINKS.list,
    ),
  component: function ProjectUsers() {
    const navigate = useNavigate({ from: Route.fullPath });
    const setSearch = useCallback<UsersScreenProps["setSearch"]>(
      (patch, options) =>
        void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: options?.replace }),
      [navigate],
    );
    return (
      <UsersScreen
        fromRoute={Route.useLoaderData()}
        search={Route.useSearch()}
        setSearch={setSearch}
        links={PROJECT_USER_LINKS}
      />
    );
  },
});

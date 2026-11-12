import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { User } from "lucide-react";
import { useCallback } from "react";

import { requirePlatformRoot } from "@/features/platform/access";
import { ManagedProject } from "@/features/projects/project-scope";
import { type UsersScreenProps, UsersScreen } from "@/features/users/components/users-screen";
import { PLATFORM_USER_LINKS } from "@/features/users/links";
import { validateUsersSearch } from "@/features/users/list";
import { loadUsers } from "@/features/users/load";
import { searchTerm } from "@/lib/search-params";

/**
 * Users at the root: the reserved platform project's users, the people who
 * may use the platform (on the hosted cloud, every customer account), drawn
 * by the project's Users list (D41). They are users as a project's are, so
 * the page has a project's name for them. Its rows open the root's own
 * detail; their schemas and teams read as text, as the root shows neither.
 * Listed for someone who may act on that project; the selected project stays
 * selected (D36), and Add user creates in the platform project.
 */
export const Route = createFileRoute("/_authed/platform/users/")({
  // Order 2: the first of the platform's own pages, right after Projects (1)
  // and before Events, as D41 lists them. The Users list's glyph, since
  // these are its rows.
  staticData: {
    platformRoot: true,
    nav: { label: "Users", view: "account", order: 2, icon: User },
  },
  validateSearch: validateUsersSearch,
  beforeLoad: requirePlatformRoot,
  // As on the project's Users: the term is not a dep, so typing does not swap
  // the screen for the pending state. Nor is the selection, which this page
  // does not read.
  loaderDeps: ({ search: { q: _q, project: _project, ...deps } }) => deps,
  // `location.search` is the URL's, which `validateSearch` has not been over.
  loader: ({ context, deps, location }) =>
    loadUsers(
      context.platformProjectId,
      { ...deps, q: searchTerm((location.search as { q?: unknown }).q) },
      PLATFORM_USER_LINKS.list,
    ),
  component: function PlatformUsers() {
    const { platformProjectId } = Route.useRouteContext();
    const navigate = useNavigate({ from: Route.fullPath });
    const setSearch = useCallback<UsersScreenProps["setSearch"]>(
      (patch, options) =>
        void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: options?.replace }),
      [navigate],
    );
    return (
      <ManagedProject id={platformProjectId}>
        <UsersScreen
          fromRoute={Route.useLoaderData()}
          search={Route.useSearch()}
          setSearch={setSearch}
          links={PLATFORM_USER_LINKS}
        />
      </ManagedProject>
    );
  },
});

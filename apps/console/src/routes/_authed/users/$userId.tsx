import { createFileRoute } from "@tanstack/react-router";

import { projectScopeDeps, requireProjectScope } from "@/features/projects/project-scope";
import { fetchUserDetail } from "@/features/users/api";
import { UserDetailScreen } from "@/features/users/components/user-detail-screen";
import { PROJECT_USER_LINKS } from "@/features/users/links";

export const Route = createFileRoute("/_authed/users/$userId")({
  staticData: { scope: "project", resource: "user" },
  loaderDeps: projectScopeDeps,
  loader: ({ params, deps }) => fetchUserDetail(params.userId, requireProjectScope(deps.project)),
  component: function ProjectUserDetail() {
    return (
      <UserDetailScreen
        userId={Route.useParams().userId}
        detail={Route.useLoaderData()}
        links={PROJECT_USER_LINKS}
      />
    );
  },
});

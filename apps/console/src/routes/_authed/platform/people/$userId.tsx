import { createFileRoute } from "@tanstack/react-router";

import { requirePlatformRoot } from "@/features/platform/access";
import { ManagedProject } from "@/features/projects/project-scope";
import { fetchUserDetail } from "@/features/users/api";
import { UserDetailScreen } from "@/features/users/components/user-detail-screen";
import { PEOPLE_USER_LINKS } from "@/features/users/links";

/**
 * One of the root's People (D41): a user of the reserved platform project,
 * drawn by the user detail screen's components. Their schema reads as text,
 * since the root shows no schemas; a linked provider opens the root's
 * Authentication, and deleting them returns to People.
 */
export const Route = createFileRoute("/_authed/platform/people/$userId")({
  staticData: { platformRoot: true, resource: "user" },
  beforeLoad: requirePlatformRoot,
  loader: ({ params, context }) => fetchUserDetail(params.userId, context.platformProjectId),
  component: function PlatformPerson() {
    const { platformProjectId } = Route.useRouteContext();
    return (
      <ManagedProject id={platformProjectId}>
        <UserDetailScreen
          userId={Route.useParams().userId}
          detail={Route.useLoaderData()}
          links={PEOPLE_USER_LINKS}
        />
      </ManagedProject>
    );
  },
});

import { createFileRoute } from "@tanstack/react-router";

import { requirePlatformRoot } from "@/features/platform/access";
import { ManagedProject } from "@/features/projects/project-scope";
import { fetchUserDetail } from "@/features/users/api";
import { UserDetailScreen } from "@/features/users/components/user-detail-screen";
import { PLATFORM_USER_LINKS } from "@/features/users/links";

/**
 * One of the root's Users (D41): a user of the reserved platform project,
 * drawn by the user detail screen's components. Their schema and a linked
 * identity provider read as text, since the root has a page for neither, and
 * deleting them returns to the root's Users.
 */
export const Route = createFileRoute("/_authed/platform/users/$userId")({
  staticData: { platformRoot: true, resource: "user" },
  beforeLoad: requirePlatformRoot,
  loader: ({ params, context }) => fetchUserDetail(params.userId, context.platformProjectId),
  component: function PlatformUser() {
    const { platformProjectId } = Route.useRouteContext();
    return (
      <ManagedProject id={platformProjectId}>
        <UserDetailScreen
          userId={Route.useParams().userId}
          detail={Route.useLoaderData()}
          links={PLATFORM_USER_LINKS}
        />
      </ManagedProject>
    );
  },
});

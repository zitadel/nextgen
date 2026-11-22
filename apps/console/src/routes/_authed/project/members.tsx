import { createFileRoute, useRouter } from "@tanstack/react-router";
import { UserCog } from "lucide-react";

import { DETAIL_STACK } from "@/components/detail-page";
import { SECTION_HEADING } from "@/components/typography";
import {
  AddAdminButton,
  ProjectMembers,
} from "@/features/project-settings/components/project-members";
import { readProjectMembers } from "@/features/project-settings/api";
import {
  projectScopeDeps,
  requireProjectScope,
  useRequiredProjectScope,
} from "@/features/projects/project-scope";

/**
 * Project Settings → Members: who has access to the project and how (#1238,
 * #2857), with Add on the heading's row. The header is the Settings layout's
 * (`route.tsx`); this page reads the members and the grants, which are the
 * same viewer check on the same project and succeed or fail as one.
 */
export const Route = createFileRoute("/_authed/project/members")({
  staticData: {
    scope: "project",
    nav: { label: "Members", view: "project-settings", order: 2, icon: UserCog },
  },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    return readProjectMembers(projectId);
  },
  component: ProjectMembersPage,
});

function ProjectMembersPage() {
  const projectId = useRequiredProjectScope();
  const { members, grants } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const reload = () => void router.invalidate();

  return (
    <div className={DETAIL_STACK}>
      <div className="flex items-center justify-between gap-6">
        <h2 className={SECTION_HEADING}>Members</h2>
        <AddAdminButton projectId={projectId} onAdded={reload} />
      </div>
      <ProjectMembers
        projectId={projectId}
        members={members}
        grants={grants}
        viewerUserId={session.user_id ?? undefined}
        onChanged={reload}
      />
    </div>
  );
}

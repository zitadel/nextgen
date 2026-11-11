import { createFileRoute, useRouter } from "@tanstack/react-router";
import { UserCog } from "lucide-react";

import { api } from "@/api/zitadel";
import { SECTION_HEADING } from "@/components/typography";
import {
  AddAdminButton,
  ProjectAdmins,
} from "@/features/project-settings/components/project-admins";
import {
  projectScopeDeps,
  requireProjectScope,
  useRequiredProjectScope,
} from "@/features/projects/project-scope";

/**
 * Project Settings → Admins: who has access to the project and how (#1238,
 * #1462), with Add on the heading's row. The header is the Settings layout's
 * (`route.tsx`); this page reads the admins and the grants, which are the same
 * viewer check on the same project and succeed or fail as one.
 */
export const Route = createFileRoute("/_authed/project/admins")({
  staticData: {
    scope: "project",
    nav: { label: "Admins", view: "project-settings", order: 2, icon: UserCog },
  },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    const [admins, grants] = await Promise.all([
      // One page each: a project's admins are a handful. Add paging with the
      // first project that needs it. The people and how they hold access come
      // from the admins list (#1462); the grants add the rows it leaves out.
      // Their principal refs carry the names, so nothing is expanded.
      api.listProjectAdmins(projectId, { limit: 100 }),
      api.queryGrants({ limit: 100 }, { project_id: projectId }),
    ]);
    return { admins: admins.admins, grants: grants.grants };
  },
  component: ProjectAdminsPage,
});

function ProjectAdminsPage() {
  const projectId = useRequiredProjectScope();
  const { admins, grants } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const reload = () => void router.invalidate();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-6">
        <h2 className={SECTION_HEADING}>Admins</h2>
        <AddAdminButton projectId={projectId} onAdded={reload} />
      </div>
      <ProjectAdmins
        projectId={projectId}
        admins={admins}
        grants={grants}
        viewerUserId={session.user_id ?? undefined}
        onChanged={reload}
      />
    </div>
  );
}

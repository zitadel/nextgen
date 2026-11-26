import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { Users } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { readInvitationsForPage } from "@/features/invitations/api";
import {
  InviteMemberButton,
  ProjectInvitations,
} from "@/features/invitations/components/project-invitations";
import { readProjectMembers } from "@/features/project-settings/api";
import { ProjectMembers } from "@/features/project-settings/components/project-members";
import {
  projectScopeDeps,
  requireProjectScope,
  useRequiredProjectScope,
} from "@/features/projects/project-scope";

/** The page's tabs; `members` is the one a bare URL opens. */
type MembersTab = "members" | "invitations";

/**
 * Project Settings → Members: every person and team with a role on the
 * project (#1238, #2857), and the links made to bring colleagues into it (root
 * ADR 086 §6, #2855), as two tabs of one page with Invite member on the tabs'
 * row. The header is the Settings layout's (`route.tsx`), which also reads the
 * project this page names in the message an administrator copies.
 *
 * The tab is in the URL (`?tab=invitations`), so a link lands on the table it
 * means and Back returns to the one left. Both tables are read up front:
 * switching reads nothing.
 *
 * The members and the grants are the same viewer check on the same project and
 * succeed or fail as one. A failed invitations read is shown in its tab rather
 * than thrown, so the members stay readable and the API's own message says why.
 *
 * Only the project's admins manage invitations. For anyone else the read is
 * refused, and the page then has no Invite member and the tab says who can
 * see invitations, instead of an error (#3331).
 */
export const Route = createFileRoute("/_authed/project/members")({
  staticData: {
    scope: "project",
    nav: { label: "Members", view: "project-settings", order: 2, icon: Users },
  },
  validateSearch: (search: Record<string, unknown>): { tab?: "invitations" } =>
    search.tab === "invitations" ? { tab: "invitations" } : {},
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    const [access, invitations] = await Promise.all([
      readProjectMembers(projectId),
      readInvitationsForPage(projectId),
    ]);
    return { ...access, invitations };
  },
  component: ProjectMembersPage,
});

const settings = getRouteApi("/_authed/project");

function ProjectMembersPage() {
  const projectId = useRequiredProjectScope();
  const { project } = settings.useLoaderData();
  const { members, grants, invitations } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const tab: MembersTab = Route.useSearch().tab ?? "members";
  const navigate = Route.useNavigate();
  const router = useRouter();
  const reload = () => void router.invalidate();
  const open = (next: MembersTab) =>
    void navigate({
      search: (prev) => ({ ...prev, tab: next === "invitations" ? next : undefined }),
    });

  return (
    <Tabs value={tab} onValueChange={(value) => open(value as MembersTab)} className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList variant="line" aria-label="Project members">
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">Invitations</TabsTrigger>
        </TabsList>
        {!("denied" in invitations) && (
          <InviteMemberButton
            projectId={projectId}
            projectName={project.name}
            onInvited={() => {
              // Closing the dialog lands on the table the new row is in.
              open("invitations");
              reload();
            }}
          />
        )}
      </div>

      <TabsContent value="members">
        <ProjectMembers
          projectId={projectId}
          members={members}
          grants={grants}
          viewerUserId={session.user_id ?? undefined}
          onChanged={reload}
        />
      </TabsContent>

      <TabsContent value="invitations">
        <ProjectInvitations
          projectId={projectId}
          projectName={project.name}
          read={invitations}
          onChanged={reload}
        />
      </TabsContent>
    </Tabs>
  );
}

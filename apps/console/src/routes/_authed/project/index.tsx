import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Boxes, Settings } from "lucide-react";
import { useState } from "react";

import { api } from "@/api/zitadel";
import { MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DetailHeader } from "@/components/detail-page";
import { Page } from "@/components/layout";
import { AddAdminButton, ProjectAdmins } from "@/components/project-admins";
import { ProjectOrigins } from "@/components/project-origins";
import { type PasswordPolicyRead, ProjectPolicies } from "@/components/project-policies";
import { ProjectVariables } from "@/components/project-variables";
import { RenameCard } from "@/components/rename-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { describeError } from "@/lib/api-error";
import { formatDate } from "@/lib/date";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";

/**
 * The selected project's own page: its detail, origins, variables and admins.
 *
 * It is the one sidebar entry about the project rather than something in it,
 * and it is scoped like the rest: the page follows the selection, and the
 * Projects overview (the sidebar's first entry) is where projects are
 * compared and picked. `/projects/$projectId` redirects here with that project
 * selected, so a link to one project's page still lands on it, and the
 * projects list's row menu opens it as `View project`.
 *
 * The header card carries `PROJECT ID` and `CREATED`. The design draws a third
 * cell, `ISSUER` — the project's issuer origin — but nothing carries it:
 * `project-response` is `id`, `name`, `origins`, `created_at` and
 * `updated_at`, and `issuer` appears nowhere in the spec, the console or the
 * domain layer. The cell is left out rather than shown empty, and returns as one
 * more `MetaValue` when the field lands.
 *
 * Two tabs, as the team's page. Overview holds the project's name, its
 * origins, its variables and secrets and its policies; Admins holds the grants (#1238), with
 * the Add button on the tab row. All of it is project-level data, so it lives
 * here rather than under account settings, and the id every request carries
 * is this route's. The origins ride on the project; the grants and the
 * variables are loaded with it, since all three reads are the same viewer
 * check on the same project and succeed or fail as one. The password policy
 * is read beside them but fails on its own: its card only shows it.
 */
export const Route = createFileRoute("/_authed/project/")({
  // Last: the list above it is the project's contents, this is the project.
  staticData: {
    scope: "project",
    nav: { label: "Settings", order: 9, icon: Settings },
  },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    const [project, grants, variables, policies] = await Promise.all([
      api.getProject(projectId),
      // One page: a project's admins are a handful. Add paging with the first
      // project that needs it.
      api.queryGrants({ limit: 100, expand: ["principal"] }, { project_id: projectId }),
      // No kind: every name with its value per kind, which is what the table
      // shows side by side.
      api.getVariables({ project_id: projectId }),
      // The password policy as its newest revision; a project that never
      // published one answers an empty list. Read-only, so a failed read
      // costs the card its row, not the page its editable sections.
      api
        .listPolicies({ project_id: projectId, operation: "auth.factor.password.set", limit: 1 })
        .then(
          (page): PasswordPolicyRead => ({ config: page.policies[0]?.config }),
          (cause): PasswordPolicyRead => ({
            error: describeError(cause, "The password policy could not be read."),
          }),
        ),
    ]);
    return { project, grants: grants.grants, variables, passwordPolicy: policies };
  },
  component: ProjectDetail,
});

type Tab = "overview" | "admins";

function ProjectDetail() {
  const { project, grants, variables, passwordPolicy } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const reload = () => void router.invalidate();

  return (
    <Page>
      <DetailHeader
        icon={Boxes}
        title={project.name}
        meta={
          <>
            <MetaValue label="Project ID" value={project.id} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(project.created_at)} />
          </>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as Tab)}
        className={`${DETAIL_BODY} gap-4`}
      >
        {/* The active tab's action sits on the tab row, as the design draws it. */}
        <div className="flex items-center justify-between gap-6">
          <TabsList aria-label="Project detail sections">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="admins">Admins</TabsTrigger>
          </TabsList>
          {tab === "admins" && <AddAdminButton projectId={project.id} onAdded={reload} />}
        </div>

        {/* The page owns the 16px between its cards. */}
        <TabsContent value="overview" className="flex flex-col gap-4">
          <RenameCard
            id="project-name"
            title="Project Detail"
            layout="inline"
            label="Project name"
            value={project.name}
            onSave={async (name) => {
              await api.patchProject(project.id, { name });
              await router.invalidate();
            }}
            errorFallback="Could not save the project."
          />
          <ProjectOrigins projectId={project.id} origins={project.origins} onChanged={reload} />
          <ProjectVariables variables={variables} />
          <ProjectPolicies password={passwordPolicy} />
        </TabsContent>

        <TabsContent value="admins" className="mt-2">
          <ProjectAdmins
            projectId={project.id}
            grants={grants}
            viewerUserId={session.user_id ?? undefined}
            onChanged={reload}
          />
        </TabsContent>
      </Tabs>
    </Page>
  );
}

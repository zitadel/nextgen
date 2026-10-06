import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AlertCircle, Box, Loader2, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";

import { EYEBROW, MetaRule, MetaValue } from "@/components/detail-meta";
import { DETAIL_BODY, DetailHeader, DetailPage } from "@/components/detail-page";
import { ProjectAdmins } from "@/components/project-admins";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import { api } from "../../../api/zitadel";
import { describeError } from "../../../lib/api-error";
import { formatDate } from "../../../lib/date";
import { projectScopeDeps, requireProjectScope } from "../../../lib/project-scope";

/**
 * Project settings — the selected project's own page.
 *
 * It is the one sidebar entry about the project rather than something in it,
 * and it is scoped like the rest: the page follows the selection, and the
 * Projects overview (the sidebar's first entry) is where projects are
 * compared and picked. `/projects/$projectId` redirects here with that project
 * selected, so a link to one project's page still lands on it.
 *
 * The header card carries `PROJECT ID` and `CREATED`. The design draws a third
 * cell, `ISSUER` — the project's issuer origin — but nothing carries it:
 * `project-response` is `id`, `name`, `allowed_origins`, `created_at` and
 * `updated_at`, and `issuer` appears nowhere in the spec, the console or the
 * domain layer. The cell is left out rather than shown empty, and returns as one
 * more `MetaValue` when the field lands.
 *
 * Below the details, the project's admins (#1238): grants are project-level
 * data, so they live on the project's page rather than under account settings,
 * and the id every grant request carries is this route's. Loaded together with
 * the project: both reads are the same viewer check on the same project, so
 * they succeed or fail as one.
 */
export const Route = createFileRoute("/_authed/project/")({
  // Last: the list above it is the project's contents, this is the project.
  staticData: {
    scope: "project",
    nav: { label: "Project settings", order: 5, icon: SlidersHorizontal },
  },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    const projectId = requireProjectScope(deps.project);
    const [project, grants] = await Promise.all([
      api.getProject(projectId),
      // One page: a project's admins are a handful. Add paging with the first
      // project that needs it.
      api.queryGrants({ limit: 100, expand: ["principal"] }, { project_id: projectId }),
    ]);
    return { project, grants: grants.grants };
  },
  component: ProjectDetail,
});

function ProjectDetail() {
  const { project, grants } = Route.useLoaderData();
  const router = useRouter();

  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  // A save re-runs the loader, and an edit elsewhere invalidates it; either way
  // the field follows the record rather than holding a stale draft.
  useEffect(() => {
    setName(project.name);
    setError(undefined);
  }, [project]);

  const trimmed = name.trim();
  const dirty = trimmed !== project.name;

  async function save() {
    if (!dirty || trimmed === "" || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.patchProject(project.id, { name: trimmed });
      await router.invalidate();
    } catch (cause) {
      setError(describeError(cause, "Could not save the project."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DetailPage>
      <DetailHeader
        icon={Box}
        title={project.name}
        meta={
          <>
            <MetaValue label="Project ID" value={project.id} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(project.created_at)} />
          </>
        }
      />

      <Card className={`${DETAIL_BODY} gap-0 rounded-xl py-0`}>
        {/* `Card Content`: inset 24px, 20px top and bottom, with a 16px gap
            between the header, the rule and the grid. */}
        <CardContent className="flex flex-col gap-4 px-6 py-5">
          <span className={EYEBROW}>Details</span>
          <Separator />
          <div className="flex flex-col gap-[18px]">
            <Field>
              <FieldLabel htmlFor="project-name">Project name</FieldLabel>
              <Input
                id="project-name"
                name="project-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={200}
              />
            </Field>
            {error && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden />
                <AlertTitle>{error}</AlertTitle>
              </Alert>
            )}
            <div className="flex justify-end">
              {/* `Variant=Secondary, State=Disabled, Size=sm` — the design's
                  resting Save is the secondary fill, which `disabled:opacity-50`
                  then dims. */}
              <Button
                variant="secondary"
                size="sm"
                className="gap-1 px-2.5 text-xs"
                onClick={() => void save()}
                disabled={!dirty || trimmed === "" || saving}
              >
                {saving && <Loader2 className="size-3 animate-spin" aria-hidden />}
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <ProjectAdmins
        projectId={project.id}
        grants={grants}
        onChanged={() => void router.invalidate()}
      />
    </DetailPage>
  );
}

import { createFileRoute, useRouter } from "@tanstack/react-router";
import { AlertCircle, Box, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { EYEBROW, MetaRule, MetaValue } from "@/components/detail-meta";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import { api } from "../../../api/zitadel";
import { describeError } from "../../../lib/api-error";
import { formatDate } from "../../../lib/date";

const PLATE = "flex size-9 items-center justify-center rounded-md bg-muted text-foreground";

/**
 * Project detail.
 *
 * The header card carries `PROJECT ID` and `CREATED`. The design draws a third
 * cell, `ISSUER` — the project's issuer origin — but nothing carries it:
 * `project-response` is `id`, `name`, `preview_origins`, `created_at` and
 * `updated_at`, and `issuer` appears nowhere in the spec, the console or the
 * domain layer. The cell is left out rather than shown empty, and returns as one
 * more `MetaValue` when the field lands.
 */
export const Route = createFileRoute("/_authed/projects/$projectId")({
  loader: ({ params }) => api.getProject(params.projectId),
  component: ProjectDetail,
});

function ProjectDetail() {
  const project = Route.useLoaderData();
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
    // The page header is inset 24px and the card 16px, and the header sits 18px
    // below the navbar — the geometry the detail frame draws.
    <div className="px-4 pt-[18px] pb-8">
      {/* Wraps rather than overflows: the meta card's width is set by the id, so
          when the title and the card no longer fit on one line the card drops
          below instead of pushing off the page edge. */}
      <div className="flex flex-col gap-4 px-2 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className={PLATE}>
            <Box className="size-4" strokeWidth={1.5} aria-hidden />
          </span>
          <h1 className="text-foreground font-serif text-2xl leading-6 tracking-tight">
            {project.name}
          </h1>
        </div>
        <Card className="max-w-full gap-0 overflow-x-auto rounded-xl py-0">
          <CardContent className="flex flex-col px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center">
            <MetaValue label="Project ID" value={project.id} copyable />
            <MetaRule />
            <MetaValue label="Created" value={formatDate(project.created_at)} />
          </CardContent>
        </Card>
      </div>

      {/* Card top sits 32px under the header row. */}
      <Card className="mt-8 gap-0 rounded-xl py-0">
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
    </div>
  );
}

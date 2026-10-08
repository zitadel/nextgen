import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { Fragment } from "react";

import { api } from "@/api/zitadel";
import { DetailPanel, PanelTitle } from "@/components/detail-page";
import { DocumentViewer } from "@/components/document-viewer";
import { DETAIL_PANEL_PAGE } from "@/components/layout";
import { SchemaFieldsPanel } from "@/components/schema-fields-panel";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { projectScopeDeps, requireProjectScope } from "@/lib/project-scope";
import { type UserSchema, schemaAuthMethods, schemaDisplayName } from "@/lib/schema";

export const Route = createFileRoute("/_authed/schemas/$schemaId")({
  staticData: { scope: "project" },
  loaderDeps: projectScopeDeps,
  // Schema ids are unique per project only (the seeded default carries the same
  // `$id` everywhere), and an ambiguous id resolves in the caller's own project
  // unless `project_id` names the selected one.
  loader: ({ params, deps }) =>
    api
      .getSchemaById(params.schemaId, { project_id: requireProjectScope(deps.project) })
      .then((body) => body.schema as UserSchema),
  component: SchemaDetail,
});

function SchemaDetail() {
  const schema = Route.useLoaderData();
  const { schemaId } = Route.useParams();
  const name = schemaDisplayName(schema, schemaId);
  const methods = schemaAuthMethods(schema);

  return (
    <div className={DETAIL_PANEL_PAGE}>
      <DetailPanel>
        {/* The schema's id is not repeated here: the list row carries it, and
            the design's lockup has only the two lines. */}
        <PanelTitle icon={Users} eyebrow="User schema" title={name} />

        <Separator />

        <Tabs defaultValue="fields" className="gap-4.5">
          {/* `py-[3px]` only — this strip has no horizontal padding, which is
              what puts the first trigger's box flush with the card's content
              edge and its label in line with `SCHEMA` below. (The viewer's own
              JSON/YAML strip does use `p-[3px]`.) */}
          <TabsList className="h-10 px-0 py-[3px]">
            <TabsTrigger value="fields" variant="muted">
              Fields
            </TabsTrigger>
            <TabsTrigger value="authentication" variant="muted">
              Authentication
            </TabsTrigger>
          </TabsList>

          <TabsContent value="fields">
            {/* The field table is a fixed 468px and the viewer takes the rest,
                matching height. Stacked below `lg`, where the design puts the
                viewer under the table.

                `pl-2` because the design insets this row by 8px on the left
                while the tab strip above starts at the content edge: a tab
                trigger is `px-2`, so the effect is that `SCHEMA` lines up with
                the tab *label* and the tab's box sits just outside it. */}
            <div className="flex flex-col gap-4.5 lg:flex-row lg:items-stretch lg:pl-2">
              <div className="lg:w-[468px] lg:shrink-0">
                <SchemaFieldsPanel schema={schema} />
              </div>
              <DocumentViewer document={schema} noun="schema" />
            </div>
          </TabsContent>

          <TabsContent value="authentication">
            {/* `px-2`, the same 8px inset the Fields tab uses, so the section
                heading lines up with the tab label above it rather than with
                the tab's box. */}
            <section className="flex flex-col gap-2.5 px-2">
              <h2 className="font-serif text-[15px] leading-[22px] text-foreground">
                Sign-in methods
              </h2>
              {methods.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  This schema declares no sign-in methods.
                </p>
              ) : (
                methods.map((method) => (
                  <Fragment key={method.key}>
                    <Separator className={RULE} />
                    <div className="flex items-center justify-between gap-4 py-1">
                      <span className="text-sm leading-5 font-medium text-foreground">
                        {method.label}
                      </span>
                      <Badge variant="secondary" className="h-5">
                        {method.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                  </Fragment>
                ))
              )}
            </section>
          </TabsContent>
        </Tabs>
      </DetailPanel>
    </div>
  );
}

// The rules between sign-in methods take no vertical space: the design draws
// them as zero-height lines with the hairline outside the box, so the 10px
// column gap sits either side of the rule rather than 10px + the rule's own
// height. `Separator` is `h-px`, which is enough to drift the rows below it.
const RULE = "h-0 border-t border-border bg-transparent";

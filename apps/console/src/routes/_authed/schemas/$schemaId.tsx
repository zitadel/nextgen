import { createFileRoute } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { Fragment } from "react";

import { SchemaDocumentViewer } from "@/components/schema-document-viewer";
import { SchemaFieldsPanel } from "@/components/schema-fields-panel";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type UserSchema, schemaAuthMethods, schemaDisplayName } from "@/lib/schema";

import { api } from "../../../api/zitadel";
import { getConsoleProjectId } from "../../../runtime/runtime";

export const Route = createFileRoute("/_authed/schemas/$schemaId")({
  loader: ({ params }) =>
    api.getSchemaById(params.schemaId, {
      project_id: getConsoleProjectId(),
    }) as Promise<UserSchema>,
  component: SchemaDetail,
});

function SchemaDetail() {
  const schema = Route.useLoaderData();
  const { schemaId } = Route.useParams();
  const name = schemaDisplayName(schema, schemaId);
  const methods = schemaAuthMethods(schema);

  return (
    <div className="px-4 pt-9 pb-8 sm:px-8">
      <Card className="gap-4 border-foreground/10 px-6 py-5 shadow-xs">
        {/* The `Title` lockup (`1389:190643`): icon tile + eyebrow + title.
            The schema's id is not repeated here — the list row carries it, and
            the design's lockup has only the two lines. */}
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted"
          >
            <Users className="size-4 text-foreground" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className={OVERLINE}>User schema</span>
            <h1 className="truncate font-serif text-lg leading-6 text-foreground">{name}</h1>
          </div>
        </div>

        <Separator />

        <Tabs defaultValue="fields" className="gap-[18px]">
          {/* `py-[3px]` only — this strip has no horizontal padding, which is
              what puts the first trigger's box flush with the card's content
              edge and its label in line with `SCHEMA` below. (The viewer's own
              JSON/YAML strip does use `p-[3px]`.) */}
          <TabsList className="h-10 px-0 py-[3px]">
            <TabsTrigger value="fields" className={TAB}>
              Fields
            </TabsTrigger>
            <TabsTrigger value="authentication" className={TAB}>
              Authentication
            </TabsTrigger>
          </TabsList>

          <TabsContent value="fields">
            {/* The field table is a fixed 468px and the viewer takes the rest,
                matching height. Stacked below `lg` — the design's narrow frame
                puts the viewer under the table.

                `pl-2` because the design insets this row by 8px on the left
                while the tab strip above starts at the content edge: a tab
                trigger is `px-2`, so the effect is that `SCHEMA` lines up with
                the tab *label* and the tab's box sits just outside it. */}
            <div className="flex flex-col gap-[18px] lg:flex-row lg:items-stretch lg:pl-2">
              <div className="lg:w-[468px] lg:shrink-0">
                <SchemaFieldsPanel schema={schema} />
              </div>
              <SchemaDocumentViewer schema={schema} />
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
      </Card>
    </div>
  );
}

// The display face, uppercase 12px with 0.72px tracking — the design's
// `caption/overline` style, shared with the field table's column headers.
const OVERLINE = "font-serif text-xs leading-4 tracking-[0.72px] text-muted-foreground uppercase";

// The rules between sign-in methods take no vertical space: the design draws
// them as zero-height lines with the hairline outside the box, so the 10px
// column gap sits either side of the rule rather than 10px + the rule's own
// height. `Separator` is `h-px`, which is enough to drift the rows below it.
const RULE = "h-0 border-t border-border bg-transparent";

// `flex-none` because shadcn's trigger is `flex-1`, which would stretch both
// tabs to a shared width inside the `w-fit` list; the design hugs each label.
// The active fill is `muted`, where the installed default paints `background`
// in light and `input/30` in dark.
const TAB =
  "flex-none data-[state=active]:bg-muted dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-muted";

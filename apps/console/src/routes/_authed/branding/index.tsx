import { createFileRoute } from "@tanstack/react-router";
import { Monitor, Smartphone, Sun, Workflow } from "lucide-react";
import { useState } from "react";

import {
  LoginPreview,
  type PreviewJourney,
  type PreviewState,
} from "@/components/branding/login-preview";
import { SettingsPanel } from "@/components/branding/settings-panel";
import { RESOURCE_HEADER, RESOURCE_PAGE } from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BrandingRevision } from "@/lib/branding-palette";
import { flowDisplayName } from "@/lib/flow-definition";

import { api } from "../../../api/zitadel";
import { projectScopeDeps, requireProjectScope } from "../../../lib/project-scope";

export const Route = createFileRoute("/_authed/branding/")({
  // Nested under Login flows, as in the design: branding is how those flows
  // render, not a resource of its own. Sub-rows carry no icon.
  staticData: { scope: "project", nav: { label: "Branding", order: 1, parent: "/flow-definitions" } },
  loaderDeps: projectScopeDeps,
  loader: async ({ deps }) => {
    // Newest first, so the head of the list is what visitors see today. The
    // list carries ids only, so the configuration itself is a second call. A
    // project that has never published branding has no revision, and the
    // panel then shows the maintained defaults.
    const projectId = requireProjectScope(deps.project);
    const [revisions, flows] = await Promise.all([
      api.listBranding({ project_id: projectId }),
      // One row per flow rather than per revision (#1246), as the Login
      // flows directory asks for it. The preview starts a flow by name, so a
      // second revision of one is an ambiguous row rather than another choice.
      api.listFlowDefinitions({ project_id: projectId, revisions: "latest" }),
    ]);
    // The preview runs one of the project's own flows, so the selector lists
    // what it can actually render rather than a fixed set.
    //
    // Each entry carries the purposes it serves. A definition can serve one
    // without the other, and starting a flow for a purpose it does not serve
    // answers `flowdef.purpose_mismatch` rather than a preview.
    const previewFlows: PreviewFlow[] = flows.flow_definitions.map((entry) => ({
      name: entry.flow_definition.name,
      label: flowDisplayName(entry.flow_definition),
      purposes: Object.keys(entry.flow_definition.purposes ?? {}),
      successStep: successStepName(entry.flow_definition.steps),
    }));
    const latest = revisions[0];
    if (!latest) return { revision: {} as BrandingRevision, flows: previewFlows };
    const found = await api.getBrandingById(latest.id);
    return { revision: found.branding as BrandingRevision, flows: previewFlows };
  },
  component: BrandingScreen,
});

/** A flow the preview can run, the purposes it serves, and its terminal screen. */
type PreviewFlow = { name: string; label: string; purposes: string[]; successStep?: string };

/**
 * The step a flow ends on a screen with: its one `complete: "show"` step. A
 * flow that declares none, or several, leaves the choice to the element.
 */
function successStepName(steps: { name: string; complete?: string }[] = []): string | undefined {
  const shown = steps.filter((step) => step.complete === "show");
  return shown.length === 1 ? shown[0]?.name : undefined;
}

// Passkey is absent: it needs a step the flow only reaches after an
// identifier, which the preview cannot ask for (the element shows the entry
// step in a chosen state; a later step exists only once the server has walked
// the flow to it), and a tab that renders the sign-in step under another name
// claims a journey it does not preview.
const JOURNEYS: { id: PreviewJourney; label: string }[] = [
  { id: "register", label: "Sign up" },
  { id: "login", label: "Sign in" },
];

// The states of the design's selector, in its order. All of them are the
// element's own rendering of the step the project serves; none writes to it.
// Keyed by state, so one the element gains has to be labelled here to compile.
const STATE_LABELS: Record<PreviewState, string> = {
  default: "Default",
  validation_error: "Validation errors",
  submission_error: "Submission error",
  loading: "Loading",
  success: "Success",
};

// The flow selector is drawn as a ghost button, not a bordered select: no
// border or shadow, and its icons take the foreground colour rather than the
// muted one a bordered trigger uses.
const GHOST_TRIGGER =
  "h-9 gap-1.5 border-0 px-2.5 font-medium shadow-none hover:bg-accent hover:text-accent-foreground dark:bg-transparent dark:hover:bg-accent [&_svg:not([class*='text-'])]:text-foreground";

/**
 * Which side the preview paints: a fixed side, or `revision` to leave it to
 * the revision's own `theme.mode` — what a visitor gets. A pinned side still
 * cannot reach one the revision does not publish.
 */
type PreviewTheme = "light" | "dark" | "revision";

function BrandingScreen() {
  const { revision, flows } = Route.useLoaderData();
  // What the operator last picked; `activeJourney` below is what renders.
  const [journey, setJourney] = useState<PreviewJourney>("register");
  // What the operator last picked; `activeFlowName` below is what renders.
  const [flowName, setFlowName] = useState(flows[0]?.name ?? "");
  const [theme, setTheme] = useState<PreviewTheme>("revision");
  const [state, setState] = useState<PreviewState>("default");
  const [narrow, setNarrow] = useState(false);

  // Only the journeys the chosen flow actually serves: asking it for a purpose
  // it does not carry answers `flowdef.purpose_mismatch` instead of rendering.
  // A flow the list did not describe is treated as serving everything, so a
  // missing `purposes` narrows nothing.
  //
  // Switching projects keeps this screen mounted and reloads `flows`, so a pick
  // from the previous project can name a flow this one does not have. It falls
  // back to the first flow, derived like `activeJourney` below.
  const selected = flows.find((flow) => flow.name === flowName) ?? flows[0];
  const activeFlowName = selected?.name ?? "";
  const journeys = selected?.purposes.length
    ? JOURNEYS.filter((entry) => selected.purposes.includes(entry.id))
    : JOURNEYS;
  // Derived rather than corrected in state: switching to a flow that does not
  // serve the picked tab previews one it does, and switching back restores
  // the pick, without a render-time setState.
  const activeJourney = journeys.some((entry) => entry.id === journey)
    ? journey
    : (journeys[0]?.id ?? journey);
  // Unset, a widget follows the visitor: the panel shows `auto` for it too.
  const revisionMode = revision.theme?.mode ?? "auto";

  return (
    <div className={`${RESOURCE_PAGE} pt-4`}>
      <div className={`${RESOURCE_HEADER} flex h-9 items-center`}>
        <h1 className="font-serif text-2xl leading-6 tracking-tight text-foreground">Branding</h1>
      </div>

      {/* Three rows on a phone, one on a desktop: the flow selector, then the
          tabs with the environment buttons edge-aligned, then the state
          selector, which is too wide to share the tabs' row at that width.
          The separators only exist inline. */}
      <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-[10px] lg:px-2">
        {flows.length > 0 && (
          <div className="flex items-center justify-between gap-[10px]">
            <Select value={activeFlowName} onValueChange={setFlowName}>
              <SelectTrigger aria-label="Previewed flow" className={GHOST_TRIGGER}>
                <Workflow />
                <SelectValue />
              </SelectTrigger>
              {/* Item-aligned is the shadcn default: it lays the selected row
                  over the trigger, so with one flow the menu reads as the
                  button growing a tick. The design drops it below. */}
              <SelectContent position="popper" sideOffset={4}>
                {flows.map((flow) => (
                  <SelectItem key={flow.name} value={flow.name}>
                    Flow: {flow.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* The vertical variant sets h-full, which wins over a plain h-5 and
                collapses to nothing in a centred row, so the height is forced. */}
            <Separator orientation="vertical" className="hidden h-5! lg:block" />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-[10px] gap-y-2 lg:flex-1">
          <Tabs
            value={activeJourney}
            onValueChange={(value) => setJourney(value as PreviewJourney)}
          >
            <TabsList>
              {journeys.map((entry) => (
                <TabsTrigger key={entry.id} value={entry.id}>
                  {entry.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {/* After the tabs, as the design orders the row: flow, screen, state.
              No icon on this one; the flow selector alone carries its glyph. */}
          <div className="order-last flex basis-full items-center gap-[10px] sm:order-none sm:basis-auto">
            <Separator orientation="vertical" className="hidden h-5! lg:block" />
            <Select value={state} onValueChange={(value) => setState(value as PreviewState)}>
              <SelectTrigger aria-label="Previewed state" className={GHOST_TRIGGER}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" sideOffset={4}>
                {Object.entries(STATE_LABELS).map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    State: {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={narrow ? "Show at desktop width" : "Show at phone width"}
              aria-pressed={narrow}
              onClick={() => setNarrow((value) => !value)}
            >
              {narrow ? <Smartphone /> : <Monitor />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Switch the previewed theme"
              onClick={() => setTheme(nextTheme(theme))}
              title={
                theme === "revision"
                  ? `Theme: ${revisionMode} (from the branding in use)`
                  : `Theme: ${theme}`
              }
            >
              <Sun />
            </Button>
          </div>
        </div>
      </div>

      {/* The panel is long and the preview is content-sized, so the row takes
          its height from the viewport and the panel scrolls inside it —
          otherwise the grid stretches the preview to the panel's full length.
          302px is the design's 300 plus the 1px card border each side, so the
          content the rows align to is the 276 the design lays them out in. */}
      <div className="mt-3 grid gap-4 lg:h-[calc(100vh-11rem)] lg:grid-cols-[minmax(0,1fr)_302px] lg:px-2">
        <Card className="flex min-h-[29rem] items-center justify-center overflow-auto border-foreground/10 p-6 shadow-xs lg:min-h-[32rem]">
          {/* The widget is content-sized, so the preview constrains the width
              rather than the element: that is what an embedding page does. */}
          <div className={narrow ? "w-[24rem]" : "w-full max-w-[32rem]"}>
            <LoginPreview
              journey={activeJourney}
              flowName={activeFlowName}
              theme={theme}
              state={state}
              successStep={selected?.successStep}
            />
          </div>
        </Card>

        <Card className="min-h-0 overflow-hidden border-foreground/10 p-0 shadow-xs">
          <SettingsPanel revision={revision} />
        </Card>
      </div>
    </div>
  );
}

function nextTheme(current: PreviewTheme): PreviewTheme {
  if (current === "revision") return "light";
  return current === "light" ? "dark" : "revision";
}

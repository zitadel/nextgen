import { createFileRoute } from "@tanstack/react-router";
import { Monitor, Smartphone, Sun, Workflow } from "lucide-react";
import { useState } from "react";

import { LoginPreview, type PreviewJourney } from "@/components/branding/login-preview";
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
import type { BrandingDraft } from "@/lib/branding-draft";
import { flowDisplayName } from "@/lib/flow-definition";

import { api } from "../../../api/zitadel";
import { getConsoleProjectId } from "../../../runtime/runtime";

export const Route = createFileRoute("/_authed/branding/")({
  // Nested under Login flows, as in the design: branding is how those flows
  // render, not a resource of its own. Sub-rows carry no icon.
  staticData: { nav: { label: "Branding", order: 1, parent: "/flow-definitions" } },
  loader: async () => {
    // Newest first, so the head of the list is what visitors see today. The
    // list carries ids only, so the configuration itself is a second call. A
    // project that has never published branding has no revision, and the draft
    // then starts from the maintained defaults.
    const projectId = getConsoleProjectId();
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
    }));
    const latest = revisions[0];
    if (!latest) return { published: {} as BrandingDraft, flows: previewFlows };
    const revision = await api.getBrandingById(latest.id);
    return { published: revision.branding as BrandingDraft, flows: previewFlows };
  },
  component: BrandingScreen,
});

/** A flow the preview can run, and the purposes it serves. */
type PreviewFlow = { name: string; label: string; purposes: string[] };

// Passkey is absent until the state selector lands: it needs a step the flow
// only reaches after an identifier, and a tab that renders the sign-in step
// under another name claims a journey it does not preview.
const JOURNEYS: { id: PreviewJourney; label: string }[] = [
  { id: "register", label: "Sign up" },
  { id: "login", label: "Sign in" },
];

// The flow selector is drawn as a ghost button, not a bordered select: no
// border or shadow, and its icons take the foreground colour rather than the
// muted one a bordered trigger uses.
const GHOST_TRIGGER =
  "h-9 gap-1.5 border-0 px-2.5 font-medium shadow-none hover:bg-accent hover:text-accent-foreground dark:bg-transparent dark:hover:bg-accent [&_svg:not([class*='text-'])]:text-foreground";

function BrandingScreen() {
  const { published, flows } = Route.useLoaderData();
  // The draft starts from what is in use, per #936: customisation continues
  // from the appearance currently live rather than from an empty form.
  const [draft, setDraft] = useState<BrandingDraft>(published);
  const [journey, setJourney] = useState<PreviewJourney>("register");
  const [flowName, setFlowName] = useState(flows[0]?.name ?? "");

  // Only the journeys the chosen flow actually serves: asking it for a purpose
  // it does not carry answers `flowdef.purpose_mismatch` instead of rendering.
  // A flow the list did not describe is treated as serving everything, so a
  // missing `purposes` narrows nothing.
  const selected = flows.find((flow) => flow.name === flowName);
  const journeys = selected?.purposes.length
    ? JOURNEYS.filter((entry) => selected.purposes.includes(entry.id))
    : JOURNEYS;
  // Switching to a flow that does not serve the open tab moves to one it does,
  // rather than leaving a tab selected that the preview cannot start.
  const activeJourney = journeys.some((entry) => entry.id === journey)
    ? journey
    : (journeys[0]?.id ?? journey);
  if (activeJourney !== journey) setJourney(activeJourney);
  const [theme, setTheme] = useState<"light" | "dark" | "auto">("auto");
  const [narrow, setNarrow] = useState(false);

  return (
    <div className={`${RESOURCE_PAGE} pt-4`}>
      <div className={`${RESOURCE_HEADER} flex h-9 items-center`}>
        <h1 className="font-serif text-2xl leading-6 tracking-tight text-foreground">Branding</h1>
      </div>

      {/* Two rows on a phone, one on a desktop: the design pairs the selectors
          on the first row and the tabs with the environment buttons on the
          second, each edge-aligned. The separators only exist inline. */}
      <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-[10px] lg:px-2">
        {flows.length > 0 && (
          <div className="flex items-center justify-between gap-[10px]">
            <Select value={flowName} onValueChange={setFlowName}>
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
        <div className="flex items-center justify-between gap-[10px] lg:flex-1">
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

          <div className="flex items-center gap-2 lg:ml-auto">
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
              title={`Theme: ${theme}`}
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
            <LoginPreview draft={draft} journey={activeJourney} flowName={flowName} theme={theme} />
          </div>
        </Card>

        <Card className="min-h-0 overflow-hidden border-foreground/10 p-0 shadow-xs">
          <SettingsPanel draft={draft} onChange={setDraft} />
        </Card>
      </div>
    </div>
  );
}

function nextTheme(current: "light" | "dark" | "auto"): "light" | "dark" | "auto" {
  if (current === "auto") return "light";
  return current === "light" ? "dark" : "auto";
}

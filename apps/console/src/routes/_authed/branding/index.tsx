import { createFileRoute } from "@tanstack/react-router";
import { Monitor, Palette, Smartphone, Sun } from "lucide-react";
import { useState } from "react";

import { LoginPreview, type PreviewJourney } from "@/components/branding/login-preview";
import { SettingsPanel } from "@/components/branding/settings-panel";
import { RESOURCE_HEADER, RESOURCE_PAGE } from "@/components/resource-list";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BrandingDraft } from "@/lib/branding-draft";

import { api } from "../../../api/zitadel";
import { getConsoleProjectId } from "../../../runtime/runtime";

export const Route = createFileRoute("/_authed/branding/")({
  // Order 5: Login flows sits at 4, and branding configures what those flows render.
  staticData: { nav: { label: "Branding", order: 5, icon: Palette } },
  loader: async () => {
    // Newest first, so the head of the list is what visitors see today. The
    // list carries ids only, so the configuration itself is a second call. A
    // project that has never published branding has no revision, and the draft
    // then starts from the maintained defaults.
    const revisions = await api.listBranding({ project_id: getConsoleProjectId() });
    const latest = revisions[0];
    if (!latest) return { published: {} as BrandingDraft };
    const revision = await api.getBrandingById(latest.id);
    return { published: revision.branding as BrandingDraft };
  },
  component: BrandingScreen,
});

const JOURNEYS: { id: PreviewJourney; label: string }[] = [
  { id: "register", label: "Sign up" },
  { id: "login", label: "Sign in" },
  { id: "passkey", label: "Passkey" },
];

function BrandingScreen() {
  const { published } = Route.useLoaderData();
  // The draft starts from what is in use, per #936: customisation continues
  // from the appearance currently live rather than from an empty form.
  const [draft, setDraft] = useState<BrandingDraft>(published);
  const [journey, setJourney] = useState<PreviewJourney>("register");
  const [theme, setTheme] = useState<"light" | "dark" | "auto">("auto");
  const [narrow, setNarrow] = useState(false);

  return (
    <div className={`${RESOURCE_PAGE} pt-4`}>
      <div className={`${RESOURCE_HEADER} flex h-9 items-center`}>
        <h1 className="font-serif text-2xl leading-6 tracking-tight text-foreground">Branding</h1>
      </div>

      <div className="mt-3 flex items-center gap-3 px-2">
        <Tabs value={journey} onValueChange={(value) => setJourney(value as PreviewJourney)}>
          <TabsList>
            {JOURNEYS.map((entry) => (
              <TabsTrigger key={entry.id} value={entry.id}>
                {entry.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="ml-auto flex items-center gap-1">
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

      {/* The panel is long and the preview is content-sized, so the row takes
          its height from the viewport and the panel scrolls inside it —
          otherwise the grid stretches the preview to the panel's full length.
          302px is the design's 300 plus the 1px card border each side, so the
          content the rows align to is the 276 the design lays them out in. */}
      <div className="mt-3 grid gap-4 lg:h-[calc(100vh-11rem)] lg:grid-cols-[minmax(0,1fr)_302px]">
        <Card className="flex min-h-[32rem] items-center justify-center overflow-auto border-foreground/10 p-6 shadow-xs">
          {/* The widget is content-sized, so the preview constrains the width
              rather than the element: that is what an embedding page does. */}
          <div className={narrow ? "w-[24rem]" : "w-full max-w-[32rem]"}>
            <LoginPreview draft={draft} journey={journey} flowName="" theme={theme} />
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

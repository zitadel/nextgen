import { Layers3, Link as LinkIcon } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { FormSheet, FormSheetForm } from "@/components/form-sheet";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldContent,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { MetaItem } from "@/components/ui/meta-item";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useSubmit } from "@/hooks/use-submit";
import { describeError } from "@/lib/api-error";
import { deployToPrimary, listPrimaryOrigins, livePrimaryReleaseId } from "@/lib/deployment";
import { useRequiredProjectScope } from "@/lib/project-scope";
import { listDeployableReleases, type ReleaseSummary } from "@/lib/release";

const SECTION = "flex flex-col gap-4";
// The design wraps the label in a row so a marker can sit beside it, rather
// than appending to the label text itself.
const LABEL_ROW = "flex w-full items-center gap-2";
/**
 * The field label's face, on the legend of the targets group. The legend keeps
 * its own 12px under it: a `legend` sits outside the fieldset's flex gap.
 */
const LEGEND = "font-serif text-sm leading-5 font-normal";
/**
 * A choice card, shared with the Rollback drawer: the label's own card
 * styling, at the design's 12px inset. `p-3!`: the label's `[&>*]:data-[slot=field]:p-4` is a variant
 * and out-specifies a plain `p-3`. The chosen card keeps the input border; the
 * label's own `border-primary` is a solid highlight the design does not draw.
 * The card's text is the sans face: the label it sits in is the display face,
 * which its children would inherit.
 */
export const CHOICE_CARD =
  "font-sans has-data-[state=checked]:border-input [&>*]:data-[slot=field]:p-3!";

const RELEASE_TRIGGER =
  "w-full *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:text-left";

/** What a deployed release says, from either entry point. */
export const DEPLOYED_MESSAGE = "Release deployed";
/** What a redeployed release says. */
export const REDEPLOYED_MESSAGE = "Release redeployed";

/**
 * The drawer's two intents share one form; the copy differs. A redeploy is a
 * deploy of the same release to the same targets again: on the primary
 * origins the server writes nothing and answers with the live deployment,
 * on a preview it refreshes the URL.
 */
export type DeployIntent = "deploy" | "redeploy";

const COPY: Record<DeployIntent, { title: string; submit: string; done: string }> = {
  deploy: { title: "Deploy release", submit: "Deploy release", done: DEPLOYED_MESSAGE },
  redeploy: { title: "Redeploy release", submit: "Redeploy release", done: REDEPLOYED_MESSAGE },
};

/**
 * The Deploy release drawer (decisions log D15): the release, where it goes,
 * and an optional message.
 *
 * Opened from a release's header the release is that one. Opened from the
 * Deployments directory's **New deployment** the operator picks one of the
 * project's releases that is not revoked and not already live on the primary
 * origins, since deploying that one again changes nothing; with none left
 * the picker says so. **Redeploy**, from either menu, is the same drawer for
 * the release in hand with its own copy.
 *
 * Where it goes is the project's primary origins, which is what
 * `POST /deployments` resolves `primary` to; the card lists them so the
 * operator deploys to what they see. The design also draws a **Preview** card
 * taking a URL; the server does not deploy to preview URLs yet, so that card
 * waits for it (#1857).
 *
 * Deploying the release the origins already serve writes nothing on the
 * server, which answers with the live deployment; the drawer reports it as
 * deployed either way, because it is.
 */
export function DeploySheet({
  children,
  release,
  intent = "deploy",
  open,
  onOpenChange,
  onDeployed,
}: {
  /** The trigger, for callers that have one. */
  children?: ReactNode;
  /** The release to deploy. Omitted, the operator picks one. */
  release?: { id: string };
  intent?: DeployIntent;
  /** Controlled open state, for a drawer opened from a menu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called once the deployment is recorded, so the caller refreshes what it shows. */
  onDeployed: () => void | Promise<void>;
}) {
  return (
    <FormSheet trigger={children} open={open} onOpenChange={onOpenChange}>
      {(close) => (
        <DeployForm release={release} intent={intent} onDeployed={onDeployed} onClose={close} />
      )}
    </FormSheet>
  );
}

function DeployForm({
  release,
  intent,
  onDeployed,
  onClose,
}: {
  release?: { id: string };
  intent: DeployIntent;
  onDeployed: () => void | Promise<void>;
  onClose: () => void;
}) {
  const copy = COPY[intent];
  const projectId = useRequiredProjectScope();
  const releaseFieldId = useId();
  const primaryId = useId();
  const messageId = useId();
  const [releases, setReleases] = useState<ReleaseSummary[] | undefined>(undefined);
  const [origins, setOrigins] = useState<string[] | undefined>(undefined);
  const [releaseId, setReleaseId] = useState(release?.id ?? "");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // The releases are read only when there is a choice to make.
        const [primary, options, liveId] = await Promise.all([
          listPrimaryOrigins(projectId),
          release ? undefined : listDeployableReleases(projectId),
          release ? undefined : livePrimaryReleaseId(projectId),
        ]);
        if (cancelled) return;
        setOrigins(primary);
        if (options) setReleases(options.filter((option) => option.id !== liveId));
      } catch (cause) {
        if (!cancelled) setLoadError(describeError(cause, "Could not load the project."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, release]);

  const options = release ? [release] : (releases ?? []);
  const loading = origins === undefined || (!release && releases === undefined);
  const nothingToDeploy = !release && releases !== undefined && releases.length === 0;

  const deploy = useSubmit(async () => {
    await deployToPrimary(projectId, releaseId, message.trim() || undefined);
    toast.success(copy.done);
    onClose();
    await onDeployed();
  }, "The release could not be deployed.");

  return (
    <FormSheetForm
      title={copy.title}
      submitLabel={copy.submit}
      canSubmit={releaseId !== "" && origins !== undefined && origins.length > 0}
      pending={deploy.pending}
      error={deploy.error ?? loadError}
      onSubmit={() => void deploy.run()}
      onClose={onClose}
    >
      <div className={SECTION}>
        <Field>
          <FieldLabel htmlFor={releaseFieldId}>Release</FieldLabel>
          {/* Fixed to the release the drawer was opened from, where it was. */}
          <Select
            value={releaseId}
            onValueChange={setReleaseId}
            disabled={release !== undefined || releases === undefined || nothingToDeploy}
          >
            {/* The trigger spaces its children out; the value takes the room
                between the glyph and the chevron so the text starts at the
                glyph. Set from the trigger: the value drops its own `className`. */}
            <SelectTrigger id={releaseFieldId} className={RELEASE_TRIGGER}>
              <Layers3 aria-hidden />
              <SelectValue
                placeholder={
                  loading
                    ? "Loading releases…"
                    : nothingToDeploy
                      ? "No release to deploy"
                      : "Select release"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {nothingToDeploy && (
            <p className="text-xs leading-4 text-muted-foreground">
              Every release is already deployed to the primary origins.
            </p>
          )}
        </Field>

        <Separator />

        <FieldSet>
          <FieldLegend variant="label" className={LEGEND}>
            Deploy to
          </FieldLegend>
          {/* One card, checked: the server deploys to primary origins only, and
              the card is where the preview choice slots in. */}
          <RadioGroup value="primary" aria-label="Deploy to">
            <FieldLabel htmlFor={primaryId} className={CHOICE_CARD}>
              <Field orientation="horizontal">
                <FieldContent className="gap-3">
                  <FieldTitle className="leading-none">Primary</FieldTitle>
                  <PrimaryOrigins origins={origins} />
                </FieldContent>
                <RadioGroupItem value="primary" id={primaryId} />
              </Field>
            </FieldLabel>
          </RadioGroup>
        </FieldSet>

        <Separator />

        <Field>
          <div className={LABEL_ROW}>
            <FieldLabel htmlFor={messageId}>Message</FieldLabel>
            {/* A sibling of the label, not part of it, so the accessible name
                stays the field name. */}
            <MetaItem>Optional</MetaItem>
          </div>
          <Textarea
            id={messageId}
            name="message"
            maxLength={1024}
            placeholder="Describe the purpose of deployment"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </Field>
      </div>
    </FormSheetForm>
  );
}

/**
 * The origins the deployment goes to, each opening what it serves. A project
 * with none cannot be deployed to, and the card says so in place of the list.
 */
function PrimaryOrigins({ origins }: { origins: string[] | undefined }) {
  if (origins === undefined) {
    return <p className="text-xs leading-4 text-muted-foreground">Loading origins…</p>;
  }
  if (origins.length === 0) {
    return (
      <p className="text-xs leading-4 text-muted-foreground">This project has no primary origin.</p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {origins.map((origin) => (
        <li key={origin} className="flex min-w-0">
          {/* `px-0!`: the size's `has-[>svg]:px-1.5` is a variant and
              out-specifies a plain `px-0`. */}
          <Button
            asChild
            variant="link"
            size="xs"
            className="h-6 max-w-full px-0! text-muted-foreground"
          >
            <a href={origin} target="_blank" rel="noreferrer">
              <LinkIcon aria-hidden />
              <span className="truncate">{origin}</span>
            </a>
          </Button>
        </li>
      ))}
    </ul>
  );
}

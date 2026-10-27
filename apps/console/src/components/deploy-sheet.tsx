import { Layers3 } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { toast } from "sonner";

import {
  FormSheet,
  FormSheetForm,
  SHEET_CHOICE_CARD,
  SHEET_LABEL_ROW,
  SHEET_LEGEND,
  SHEET_SECTION,
} from "@/components/form-sheet";
import {
  Field,
  FieldContent,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { FieldOptionalIndicator } from "@/components/ui/field-optional-indicator";
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
import { OriginLink } from "@/components/origin-link";
import {
  type Deployment,
  deployToPrimary,
  listPrimaryOrigins,
  livePrimaryDeployment,
} from "@/lib/deployment";
import { useRequiredProjectScope } from "@/lib/project-scope";
import { listDeployableReleases, type ReleaseSummary } from "@/lib/release";

const RELEASE_TRIGGER =
  "w-full *:data-[slot=select-value]:flex-1 *:data-[slot=select-value]:text-left";

/** What a deployed release says, from either entry point. */
export const DEPLOYED_MESSAGE = "Release deployed";
/** What a redeployed release says. */
export const REDEPLOYED_MESSAGE = "Release redeployed";
/** What a deploy says when the server answers with the deployment that was already live. */
export const ALREADY_LIVE_MESSAGE =
  "This release is already live on the primary origins with the same origins and values, so no new deployment was recorded.";

/**
 * The drawer's two intents share one form; the copy differs. A redeploy is a
 * deploy of the same release to the same targets again: a real deployment
 * when the primary origins or the frozen variable values changed since, and
 * otherwise answered with the deployment that is live, which the drawer
 * reports as such.
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
 * project's releases that is not revoked, the live one included: deploying
 * it again is how a changed origin or variable value goes live. With none
 * the picker says so. **Redeploy**, from either menu, is the same drawer for
 * the release in hand with its own copy.
 *
 * Where it goes is the project's primary origins, which is what
 * `POST /deployments` resolves `primary` to; the card lists them so the
 * operator deploys to what they see. The design also draws a **Preview** card
 * taking a URL; the drawer does not offer it yet, so previews are deployed
 * from the CLI.
 *
 * The deployment that is live when the drawer opens goes along as the one
 * this deploy replaces, so one that lands meanwhile refuses the deploy
 * instead of being deployed over. Deploying the release the origins already
 * serve with the same origins and values writes nothing on the server, which
 * answers with that live deployment; the drawer recognises it and says so
 * rather than reporting a deployment that did not happen.
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
  // What the primary origins served when the drawer opened; sent with the
  // deploy as the deployment it replaces.
  const [live, setLive] = useState<Deployment | undefined>(undefined);
  const [releaseId, setReleaseId] = useState(release?.id ?? "");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  // The id, not the object: a row passes a fresh literal on every render.
  const pinnedId = release?.id;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        // The releases are read only when there is a choice to make.
        const [primary, current, options] = await Promise.all([
          listPrimaryOrigins(projectId),
          livePrimaryDeployment(projectId),
          pinnedId ? undefined : listDeployableReleases(projectId),
        ]);
        if (cancelled) return;
        setOrigins(primary);
        setLive(current);
        if (options) setReleases(options);
      } catch (cause) {
        if (!cancelled) setLoadError(describeError(cause, "Could not load the project."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, pinnedId]);

  const options = release ? [release] : (releases ?? []);
  const loading = origins === undefined || (!release && releases === undefined);
  const nothingToDeploy = !release && releases !== undefined && releases.length === 0;

  const deploy = useSubmit(async () => {
    const deployed = await deployToPrimary(projectId, releaseId, {
      message: message.trim() || undefined,
      expectedDeploymentId: live?.id,
    });
    // The client sees the body, not the status: the deployment that was
    // live answered back is the server's `200`, nothing written.
    if (live !== undefined && deployed.id === live.id) toast.info(ALREADY_LIVE_MESSAGE);
    else toast.success(copy.done);
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
      <div className={SHEET_SECTION}>
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
              This project has no release to deploy.
            </p>
          )}
        </Field>

        <Separator />

        <FieldSet>
          <FieldLegend variant="label" className={SHEET_LEGEND}>
            Deploy to
          </FieldLegend>
          {/* One card, checked: the server deploys to primary origins only, and
              the card is where the preview choice slots in. */}
          <RadioGroup value="primary" aria-label="Deploy to">
            <FieldLabel htmlFor={primaryId} className={SHEET_CHOICE_CARD}>
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
          <div className={SHEET_LABEL_ROW}>
            <FieldLabel htmlFor={messageId}>Message</FieldLabel>
            {/* A sibling of the label, not part of it, so the accessible name
                stays the field name. */}
            <FieldOptionalIndicator />
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
          <OriginLink origin={origin} className="text-muted-foreground" />
        </li>
      ))}
    </ul>
  );
}

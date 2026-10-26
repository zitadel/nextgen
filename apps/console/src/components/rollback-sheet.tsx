import { Layers3 } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { DeploymentStatusBadge } from "@/components/deployment-status-badge";
import {
  FormSheet,
  FormSheetForm,
  SHEET_CHOICE_CARD,
  SHEET_LABEL_ROW,
  SHEET_LEGEND,
  SHEET_SECTION,
} from "@/components/form-sheet";
import { OriginLink } from "@/components/origin-link";
import { Field, FieldContent, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { FieldOptionalIndicator } from "@/components/ui/field-optional-indicator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useSubmit } from "@/hooks/use-submit";
import { describeError } from "@/lib/api-error";
import { formatDateTime } from "@/lib/date";
import {
  type Deployment,
  KIND_LABEL,
  type RollbackTargets,
  listRollbackTargets,
  rollbackDeployment,
} from "@/lib/deployment";
import { useRequiredProjectScope } from "@/lib/project-scope";

/** The live deployment, as a card that is not a choice: the chosen card's face. */
const SUMMARY_CARD =
  "flex flex-col gap-3 rounded-md border border-input bg-primary/5 p-3 dark:bg-primary/10";

/** What a rolled-back deployment says. */
export const ROLLED_BACK_MESSAGE = "Deployment rolled back";

/**
 * The Rollback deployment drawer: what the primary origins serve now, the
 * superseded deployments they can go back to, and an optional message.
 *
 * The rollback is a new deployment of the chosen deployment's release, with
 * the one rolled back to on its record. The live deployment is sent along as
 * the one the operator saw, so a deployment that landed meanwhile refuses
 * the rollback instead of being rolled over.
 *
 * `deploymentId` preselects a choice, from a row or a release that named
 * it. Controlled by the caller when opened from a menu.
 */
export function RollbackSheet({
  children,
  deploymentId,
  open,
  onOpenChange,
  onRolledBack,
}: {
  /** The trigger, for callers that have one. */
  children?: ReactNode;
  /** The deployment to offer as chosen. */
  deploymentId?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Called once the rollback is recorded, so the caller refreshes what it shows. */
  onRolledBack: () => void | Promise<void>;
}) {
  return (
    <FormSheet trigger={children} open={open} onOpenChange={onOpenChange}>
      {(close) => (
        <RollbackForm deploymentId={deploymentId} onRolledBack={onRolledBack} onClose={close} />
      )}
    </FormSheet>
  );
}

function RollbackForm({
  deploymentId,
  onRolledBack,
  onClose,
}: {
  deploymentId?: string;
  onRolledBack: () => void | Promise<void>;
  onClose: () => void;
}) {
  const projectId = useRequiredProjectScope();
  const messageId = useId();
  const [targets, setTargets] = useState<RollbackTargets | undefined>(undefined);
  const [selected, setSelected] = useState(deploymentId ?? "");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await listRollbackTargets(projectId);
        if (cancelled) return;
        setTargets(loaded);
        // A preselection the drawer cannot offer, such as the live deployment
        // itself, is dropped rather than submitted unseen.
        if (deploymentId && !loaded.options.some((option) => option.id === deploymentId)) {
          setSelected("");
        }
      } catch (cause) {
        if (!cancelled) setLoadError(describeError(cause, "Could not load the deployments."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, deploymentId]);

  const rollback = useSubmit(async () => {
    await rollbackDeployment(projectId, selected, {
      message: message.trim() || undefined,
      expectedDeploymentId: targets?.current?.id,
    });
    toast.success(ROLLED_BACK_MESSAGE);
    onClose();
    await onRolledBack();
  }, "The deployment could not be rolled back.");

  return (
    <FormSheetForm
      title="Rollback deployment"
      submitLabel="Rollback deployment"
      canSubmit={selected !== "" && targets !== undefined}
      pending={rollback.pending}
      error={rollback.error ?? loadError}
      onSubmit={() => void rollback.run()}
      onClose={onClose}
    >
      <div className={SHEET_SECTION}>
        <div className="flex flex-col gap-3">
          <h3 className={SHEET_LEGEND}>Current deployment</h3>
          {targets === undefined ? (
            <p className="text-xs leading-4 text-muted-foreground">Loading deployments…</p>
          ) : targets.current === undefined ? (
            <p className="text-xs leading-4 text-muted-foreground">
              No deployment is live on the primary origins.
            </p>
          ) : (
            <div className={SUMMARY_CARD}>
              <DeploymentFacts deployment={targets.current} />
            </div>
          )}
        </div>

        <Separator />

        <FieldSet>
          <FieldLegend variant="label" className={SHEET_LEGEND}>
            Roll back to
          </FieldLegend>
          {targets !== undefined && targets.options.length === 0 ? (
            <p className="text-xs leading-4 text-muted-foreground">
              There is no earlier deployment to roll back to.
            </p>
          ) : (
            <RadioGroup value={selected} onValueChange={setSelected} aria-label="Roll back to">
              {targets?.options.map((option) => (
                <RollbackOption key={option.id} deployment={option} />
              ))}
            </RadioGroup>
          )}
        </FieldSet>

        <Separator />

        <Field>
          <div className={SHEET_LABEL_ROW}>
            <FieldLabel htmlFor={messageId}>Message</FieldLabel>
            <FieldOptionalIndicator />
          </div>
          <Textarea
            id={messageId}
            name="message"
            maxLength={1024}
            placeholder="Describe the purpose for rollback"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </Field>
      </div>
    </FormSheetForm>
  );
}

/** A superseded deployment as a choice card, its facts beside the radio. */
function RollbackOption({ deployment }: { deployment: Deployment }) {
  const id = useId();
  return (
    <FieldLabel htmlFor={id} className={SHEET_CHOICE_CARD}>
      <Field orientation="horizontal">
        <FieldContent className="gap-3">
          <DeploymentFacts deployment={deployment} dated />
        </FieldContent>
        {/* Named by what tells two choices apart, which is not its id. */}
        <RadioGroupItem
          value={deployment.id}
          id={id}
          aria-label={`${deployment.release_id}, deployed ${formatDateTime(deployment.deployed_at)}`}
        />
      </Field>
    </FieldLabel>
  );
}

/**
 * The kind and whether it is live, then the release and each origin as a
 * link. `dated` adds when it was deployed, which is what tells two
 * superseded deployments of one release apart.
 */
function DeploymentFacts({
  deployment,
  dated = false,
}: {
  deployment: Deployment;
  dated?: boolean;
}) {
  return (
    <>
      <div className="flex items-center gap-1">
        <span className="text-sm leading-none font-medium text-foreground">
          {KIND_LABEL[deployment.kind]}
        </span>
        <DeploymentStatusBadge status={deployment.status} />
      </div>
      {dated && (
        <time
          dateTime={deployment.deployed_at}
          className="text-xs leading-none text-muted-foreground"
        >
          {formatDateTime(deployment.deployed_at)}
        </time>
      )}
      <ul className="flex flex-col gap-1">
        <li className="flex min-w-0">
          <span className="flex h-6 items-center gap-1 text-xs font-medium text-muted-foreground">
            <Layers3 aria-hidden className="size-3" />
            <span className="truncate">{deployment.release_id}</span>
          </span>
        </li>
        {deployment.targets.map((target) => (
          <li key={target.origin} className="flex min-w-0">
            <OriginLink origin={target.origin} className="text-muted-foreground" />
          </li>
        ))}
      </ul>
    </>
  );
}
